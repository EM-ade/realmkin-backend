# Automatic Force-Claim Scheduler Implementation

## Overview
Implemented an internal cron-based scheduler in the backend API to automatically run force-claims every Sunday at 12:00 UTC.

## Implementation Details

### Location
- **File**: `gatekeeper/backend-api/server.js`
- **Function**: `setupAutomaticForceClaim()`

### Schedule
- **Frequency**: Every Sunday at 12:00 UTC
- **Cron Pattern**: `0 12 * * 0`
- **Timezone**: UTC (explicitly configured)

### Features
1. **Automatic Execution**: Runs every Sunday without manual intervention
2. **Discord Notifications**: 
   - Success notifications with stats (claims processed, amount distributed, duration)
   - Failure notifications with error details
3. **Startup Logging**: Calculates and logs the next scheduled run time on server startup
4. **Error Handling**: Comprehensive try-catch blocks with fallback error alerts
5. **Manual Override**: Manual trigger endpoint still available at `POST /api/force-claim/trigger`

### Key Components

#### Cron Job Setup
```javascript
cron.schedule('0 12 * * 0', async () => {
  // Runs every Sunday at 12:00 UTC
  const result = await forceClaimService.runForceClaim();
  // Send notifications and log results
}, {
  scheduled: true,
  timezone: "UTC"
});
```

#### Next Run Calculation
The scheduler calculates and displays the next scheduled run on server startup:
```
[API] 📅 Next scheduled force-claim: 2026-02-08T12:00:00.000Z
```

### Dependencies
- **node-cron**: v4.2.1 (already installed in package.json)

### API Endpoints

All existing endpoints remain functional:

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/force-claim/trigger` | POST | Manual trigger | Yes (Bearer token) |
| `/api/force-claim/dry-run` | POST | Test run without changes | Yes (Bearer token) |
| `/api/force-claim/preview` | GET | Preview pending claims | Yes (Bearer token) |
| `/api/force-claim/status` | GET | Health check + next run info | No |

### Testing

Run the test script to verify configuration:
```bash
cd gatekeeper/backend-api
node scripts/test-force-claim-scheduler.js
```

**Test Results** (2026-02-01):
- ✅ Cron pattern validated
- ✅ Next 5 runs calculated correctly
- ✅ Timezone handling verified (UTC)
- ✅ Schedule creation successful

**Next Scheduled Runs**:
1. 2026-02-08T12:00:00.000Z (in 6 days)
2. 2026-02-22T12:00:00.000Z (in 20 days)
3. 2026-03-08T12:00:00.000Z (in 34 days)
4. 2026-04-22T12:00:00.000Z (in 48 days)
5. 2026-04-05T12:00:00.000Z (in 62 days)

### Discord Notifications

#### Success Message Format
```
✅ Automatic Force-Claim Completed
• Claims: [number]
• Distributed: ₥[amount]
• Duration: [time]
• Triggered: Automatic (Sunday 12:00 UTC)
```

#### Failure Message Format
```
❌ Automatic Force-Claim FAILED
• Error: [error message]
• Time: [ISO timestamp]
```

## Deployment Notes

### Environment Variables Required
- `CRON_SECRET_TOKEN`: Required for manual trigger endpoint (already configured)
- All existing force-claim service environment variables

### Server Restart
The scheduler initializes automatically when the server starts. No manual configuration needed.

### Monitoring
- Check server logs for scheduler initialization messages
- Monitor Discord for weekly execution notifications
- Use `/api/force-claim/status` endpoint for health checks

## Benefits

1. **No External Dependencies**: No need for external cron services or task schedulers
2. **Built-in Monitoring**: Discord notifications provide immediate feedback
3. **Timezone Safe**: Explicitly uses UTC to avoid timezone confusion
4. **Fault Tolerant**: Error handling ensures failures are logged and reported
5. **Flexible**: Manual trigger still available for emergency or ad-hoc runs

## Maintenance

### Changing Schedule
To modify the schedule, edit the cron pattern in `server.js`:
```javascript
cron.schedule('0 12 * * 0', async () => { ... })
//            ^  ^  ^  ^  ^
//            |  |  |  |  |
//            |  |  |  |  Day of week (0 = Sunday)
//            |  |  |  |
//            |  |  |  Month
//            |  |  Day of month
//            |  Hour (UTC)
//            Minute
```

### Disabling Scheduler
To temporarily disable, comment out the initialization call in server.js:
```javascript
// setupAutomaticForceClaim();
```

## Status
✅ **IMPLEMENTED AND TESTED** (2026-02-01)
