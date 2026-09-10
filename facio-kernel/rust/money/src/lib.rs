//! Exact-money-v1 arithmetic. No floats, external crates, allocation, I/O or host imports.
//! IDs/roles/currency are validated by the shared canonical contract. The bridge supplies shares
//! in ascending stable-ID order; the index is therefore the deterministic residual tie rank.
#![cfg_attr(target_arch = "wasm32", no_std)]

const CAPACITY: usize = 100;
const MAX_MINOR: u64 = 999_999_999_999_999_999;
const DENOMINATOR: u128 = 10_000;

/// Returns commission; writes signed allocations in the supplied stable-ID order.
fn allocate_into(premium: i64, rate: u32, shares: &[u32], amounts: &mut [i64]) -> Result<i64, u32> {
    if shares.is_empty() || shares.len() > CAPACITY || amounts.len() != shares.len() {
        return Err(1);
    }
    let magnitude = premium.unsigned_abs();
    if magnitude > MAX_MINOR || rate > 10_000 {
        return Err(2);
    }
    if shares.iter().any(|share| *share == 0 || *share > 10_000)
        || shares.iter().map(|share| *share as u64).sum::<u64>() != 10_000
    {
        return Err(3);
    }
    let sign = if premium < 0 { -1_i64 } else { 1_i64 };
    let mut remainders = [0_u32; CAPACITY];
    let mut order = [0_usize; CAPACITY];
    let mut allocated = 0_u64;
    for (index, share) in shares.iter().enumerate() {
        // Up to 10^18 * 10^4: u64 multiplication would overflow; every intermediate is u128.
        let numerator = magnitude as u128 * *share as u128;
        let amount = (numerator / DENOMINATOR) as u64;
        amounts[index] = amount as i64;
        allocated += amount;
        remainders[index] = (numerator % DENOMINATOR) as u32;
        order[index] = index;
    }
    let remaining = (magnitude - allocated) as usize;
    if remaining >= shares.len() {
        return Err(4);
    }
    if remaining > 0 {
        order[..shares.len()].sort_unstable_by(|left, right| {
            remainders[*right]
                .cmp(&remainders[*left])
                .then_with(|| left.cmp(right))
        });
        for index in order.iter().take(remaining) {
            amounts[*index] += 1;
        }
    }
    for amount in amounts {
        *amount *= sign;
    }
    let numerator = magnitude as u128 * rate as u128;
    let commission =
        numerator / DENOMINATOR + u128::from((numerator % DENOMINATOR) * 2 >= DENOMINATOR);
    Ok(commission as i64 * sign)
}

// One instance is exclusively owned by one synchronous JS bridge. No host callbacks or threads
// exist in this module. Pointers expose fixed linear-memory buffers, never arbitrary host memory.
static mut SHARES: [u32; CAPACITY] = [0; CAPACITY];
static mut AMOUNTS: [i64; CAPACITY] = [0; CAPACITY];
static mut COMMISSION: i64 = 0;

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    1
}
#[unsafe(no_mangle)]
pub extern "C" fn shares_ptr() -> *mut u32 {
    (&raw mut SHARES).cast::<u32>()
}
#[unsafe(no_mangle)]
pub extern "C" fn amounts_ptr() -> *const i64 {
    (&raw const AMOUNTS).cast::<i64>()
}
#[unsafe(no_mangle)]
pub extern "C" fn commission_ptr() -> *const i64 {
    &raw const COMMISSION
}

/// ABI v1: premium is signed i64 (JS BigInt), rate/count are u32. 0 succeeds; nonzero rejects.
#[unsafe(no_mangle)]
pub extern "C" fn allocate(premium: i64, rate: u32, count: u32) -> u32 {
    if count == 0 || count as usize > CAPACITY {
        return 1;
    }
    // SAFETY: count is bounded above, separate statics never alias, no imported function/reentry.
    // Only the documented first count output values may be read, and only following status 0.
    unsafe {
        let shares = core::slice::from_raw_parts(shares_ptr(), count as usize);
        let amounts =
            core::slice::from_raw_parts_mut((&raw mut AMOUNTS).cast::<i64>(), count as usize);
        match allocate_into(premium, rate, shares, amounts) {
            Ok(value) => {
                COMMISSION = value;
                0
            }
            Err(code) => code,
        }
    }
}

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_exact_example_and_maximum() {
        let mut amounts = [0; 4];
        assert_eq!(
            allocate_into(50_000_000, 750, &[5000, 1000, 1500, 2500], &mut amounts),
            Ok(3_750_000)
        );
        assert_eq!(amounts, [25_000_000, 5_000_000, 7_500_000, 12_500_000]);
        assert_eq!(
            allocate_into(-50_000_000, 750, &[5000, 1000, 1500, 2500], &mut amounts),
            Ok(-3_750_000)
        );
        assert_eq!(amounts, [-25_000_000, -5_000_000, -7_500_000, -12_500_000]);
        assert_eq!(
            allocate_into(MAX_MINOR as i64, 10_000, &[2500; 4], &mut amounts),
            Ok(MAX_MINOR as i64)
        );
        assert_eq!(amounts.iter().sum::<i64>(), MAX_MINOR as i64);
    }
    #[test]
    fn ties_half_away_and_invalid_inputs() {
        let mut amounts = [0; 2];
        assert_eq!(allocate_into(1, 5000, &[5000, 5000], &mut amounts), Ok(1));
        assert_eq!(amounts, [1, 0]);
        assert_eq!(allocate_into(-1, 5000, &[5000, 5000], &mut amounts), Ok(-1));
        assert_eq!(amounts, [-1, 0]);
        assert_eq!(allocate_into(0, 5000, &[5000, 5000], &mut amounts), Ok(0));
        assert_eq!(amounts, [0, 0]);
        assert_eq!(allocate_into(1, 0, &[4999, 5000], &mut amounts), Err(3));
        assert_eq!(
            allocate_into(i64::MIN, 0, &[5000, 5000], &mut amounts),
            Err(2)
        );
        assert_eq!(allocate_into(1, 10001, &[5000, 5000], &mut amounts), Err(2));
    }
}
