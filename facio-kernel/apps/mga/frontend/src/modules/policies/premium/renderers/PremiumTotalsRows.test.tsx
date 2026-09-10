// @vitest-environment happy-dom
import React from 'react';
import {expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {PremiumTotalsRows} from './PremiumTotalsRows';
it('shows the retained payable amount in its currency without converting a missing cost total to zero',()=>{
 const view=render(<table><tbody><PremiumTotalsRows cost={{subtotalNetPremium:263.39}} totalPremium={293.39} currency="EUR" feeSteps={[]} addOnTotal={0} getLimitText={vi.fn()} fmt={value=>value.toFixed(2)}/></tbody></table>);
 expect(screen.getByText('EUR 293.39')).toBeInTheDocument();
 view.rerender(<table><tbody><PremiumTotalsRows cost={{}} currency="USD" feeSteps={[]} addOnTotal={0} getLimitText={vi.fn()} fmt={value=>value.toFixed(2)}/></tbody></table>);
 expect(screen.getByText('USD —')).toBeInTheDocument();
});
