# Backend API Required Files

These are all the files you need to copy to your new backend-api repository.

## 📂 How to Copy These Files

### Option 1: Manual Copy (Easiest)
1. Copy the entire contents of this `tmp_rovodev_backend_api_files` folder
2. Paste into the ROOT of your new backend-api repository
3. Make sure the folder structure matches exactly:
   ```
   your-backend-api-repo/
   ├── backend-api/
   │   └── services/
   │       └── nftVerification.js  ← NEW
   ├── config/                     ← NEW FOLDER
   │   ├── collections.js
   │   ├── environment.js
   │   └── rateLimiting.js
   ├── utils/                      ← NEW FOLDER
   │   ├── discordAlerts.js
   │   ├── mkinPrice.js
   │   ├── mkinTransfer.js
   │   ├── rateLimiter.js
   │   ├── solPrice.js
   │   ├── supabaseClient.js
   │   └── withdrawalSecurity.js
   └── db.js                       ← NEW FILE
   ```

### Option 2: Command Line (if in same workspace)
```bash
# From this workspace directory
cp -r tmp_rovodev_backend_api_files/* /path/to/your/backend-api-repo/
```

## ✅ What Was Copied

### Config Files (3 files)
- `config/collections.js` - NFT collection definitions
- `config/environment.js` - Environment validation and configuration
- `config/rateLimiting.js` - API rate limiting configuration

### Database
- `db.js` - PostgreSQL/Neon database connection

### Services
- `backend-api/services/nftVerification.js` - NFT verification service (used by boosterService)

### Utils (7 files)
- `utils/discordAlerts.js` - Discord webhook notifications
- `utils/mkinPrice.js` - MKIN token price calculations
- `utils/solPrice.js` - SOL price calculations
- `utils/mkinTransfer.js` - MKIN token transfers
- `utils/rateLimiter.js` - Rate limiting utility
- `utils/supabaseClient.js` - Supabase client configuration
- `utils/withdrawalSecurity.js` - Withdrawal security checks

## 🚀 After Copying

1. **Commit and push to your GitHub repo:**
   ```bash
   git add .
   git commit -m "Add shared dependencies for backend-API"
   git push
   ```

2. **Redeploy on Render:**
   - Render should automatically detect the changes and redeploy
   - Or manually trigger a deploy from the Render dashboard

3. **Check the logs:**
   - Make sure there are no more "Cannot find module" errors
   - The server should start successfully on port 3001

## 🔍 Verification

After deployment, check that your server starts with:
```
✅ [API] Environment configuration validated successfully
🌍 [API] Environment: production
✅ [API] Firebase Admin initialized
🚀 [API] HTTP Server listening on 0.0.0.0:3001
```

If you see any "Cannot find module" errors, let me know which files are still missing!
