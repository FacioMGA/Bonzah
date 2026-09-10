# Load Testing with k6

**Purpose**: Establish performance benchmarks and verify system can handle production load.

---

## Quick Start

### 1. Install k6

**macOS:**
```bash
brew install k6
```

**Linux:**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

**Windows:**
```bash
choco install k6
```

### 2. Run Tests

**Smoke Test (1 minute, 5 users):**
```bash
k6 run e2e/load/smoke.test.js
```

**Quote API Load Test (5 minutes, up to 50 users):**
```bash
k6 run e2e/load/quote-api.test.js
```

**Policy List Load Test (requires auth):**
```bash
# Get auth token from login
k6 run e2e/load/policy-list.test.js -e AUTH_TOKEN=<your-jwt-token>
```

**Test against staging:**
```bash
k6 run e2e/load/quote-api.test.js -e BASE_URL=https://abbeygate.facio.io
```

---

## Test Suite

### smoke.test.js
- **Purpose**: Quick health check before full tests
- **Duration**: 1 minute
- **Users**: 5
- **Tests**: `/health`, `/health/db`, quote API
- **Threshold**: P95 < 1000ms
- **Use**: Before deployment, quick validation

### quote-api.test.js
- **Purpose**: Load test quote generation
- **Duration**: 5 minutes
- **Users**: Ramps 0 → 10 → 30 → 50 → 0
- **Endpoint flow**: `POST /api/public/motor/session` then `POST /api/public/motor/session/:token/rate`
- **Thresholds**:
  - P95 < 500ms
  - P99 < 1000ms
  - Error rate < 1%
- **Use**: Primary performance benchmark

### policy-list.test.js
- **Purpose**: Load test authenticated endpoints
- **Duration**: 4 minutes
- **Users**: Ramps 0 → 20 → 50 → 0
- **Endpoint**: `GET /api/policies`
- **Thresholds**:
  - P95 < 300ms (stricter)
  - P99 < 500ms
  - Error rate < 1%
- **Use**: Test database query optimization

---

## Understanding Results

### Key Metrics

**http_req_duration**: Time from request start to response end
- **p(95)**: 95th percentile - 95% of requests faster than this
- **p(99)**: 99th percentile - 99% of requests faster than this
- **Target**: P95 < 500ms for Quote API

**http_req_failed**: Percentage of failed requests
- **Target**: < 1%

**checks**: Success rate of assertions
- **Target**: > 99%

### Example Output
```
✓ status is 200
✓ has premium
✓ response time < 500ms

checks.........................: 98.50% ✓ 2955 ✗ 45
data_received..................: 1.2 MB 39 kB/s
data_sent......................: 890 kB 29 kB/s
http_req_duration..............: avg=245ms min=89ms med=201ms max=1.2s p(90)=389ms p(95)=456ms
http_req_failed................: 0.50%  ✓ 15   ✗ 2985
http_reqs......................: 3000   97.4/s
iterations.....................: 3000   97.4/s
```

**Analysis:**
- ✅ P95 = 456ms (target: < 500ms) - **PASS**
- ✅ Error rate = 0.50% (target: < 1%) - **PASS**
- ✅ System stable under 50 concurrent users

---

## Performance Targets

| Endpoint | P95 Target | P99 Target | Error Rate |
|----------|------------|------------|------------|
| Quote API | < 500ms | < 1000ms | < 1% |
| Policy List | < 300ms | < 500ms | < 1% |
| Policy Details | < 200ms | < 400ms | < 1% |
| Health Check | < 100ms | < 200ms | < 0.1% |

---

## CI/CD Integration

### GitHub Actions Workflow

Create `.github/workflows/load-test.yml`:

```yaml
name: Load Test

on:
  schedule:
    - cron: '0 0 * * 0' # Weekly on Sunday
  workflow_dispatch: # Manual trigger

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install k6
        run: |
          curl https://github.com/grafana/k6/releases/download/v0.45.0/k6-v0.45.0-linux-amd64.tar.gz -L | tar xvz
          sudo mv k6-v0.45.0-linux-amd64/k6 /usr/local/bin/
      
      - name: Run smoke test
        run: k6 run e2e/load/smoke.test.js -e BASE_URL=${{ secrets.STAGING_URL }}
      
      - name: Run load test
        run: k6 run e2e/load/quote-api.test.js -e BASE_URL=${{ secrets.STAGING_URL }}
      
      - name: Check results
        run: |
          if [ $? -ne 0 ]; then
            echo "Load test failed - performance regression detected"
            exit 1
          fi
```

---

## Troubleshooting

### High Error Rates

**Symptoms**: `http_req_failed > 5%`

**Possible Causes:**
1. Database connection pool exhausted
2. Rate limiting triggered
3. Server crashing under load
4. Network timeouts

**Solutions:**
- Check Application Insights for errors
- Increase database connections in Prisma
- Review rate limit settings
- Scale up Azure App Service

### Slow Response Times

**Symptoms**: `p(95) > 1000ms`

**Possible Causes:**
1. Missing database indexes
2. N+1 query patterns
3. Synchronous operations blocking
4. Insufficient server resources

**Solutions:**
- Apply database indexes (Part 3)
- Review slow query logs
- Move heavy operations to background jobs
- Scale up Azure resources

### Connection Errors

**Symptoms**: `ECONNREFUSED`, `ETIMEDOUT`

**Possible Causes:**
1. Server not running
2. Firewall blocking requests
3. Too many concurrent connections

**Solutions:**
- Verify server accessibility
- Check Azure NSG/firewall rules
- Reduce concurrent users in test

---

## Best Practices

### Before Running Load Tests

1. **Deploy latest code** to staging
2. **Apply database migrations** (especially indexes)
3. **Run smoke test** first
4. **Monitor Application Insights** during test
5. **Have rollback plan** ready

### During Load Tests

1. **Watch server metrics** (CPU, memory, database)
2. **Monitor error logs** in real-time
3. **Check Application Insights** for slow queries
4. **Note any anomalies** for investigation

### After Load Tests

1. **Review P95/P99 metrics**
2. **Investigate failures** (if error rate > 1%)
3. **Compare to previous runs** (regression check)
4. **Document results** in walkthrough
5. **Create issues** for performance problems

---

## Next Steps

1. ✅ Install k6
2. ✅ Run smoke test locally
3. ✅ Run quote API load test locally
4. → Apply database indexes (Part 3)
5. → Deploy to staging
6. → Run load tests against staging
7. → Document baseline metrics
8. → Set up weekly CI/CD load tests
