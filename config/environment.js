/**
 * Centralized Environment Configuration
 * Provides environment-specific settings for development and production
 */

class EnvironmentConfig {
  constructor() {
    this.nodeEnv = process.env.NODE_ENV || 'development';
    this.isDevelopment = this.nodeEnv === 'development';
    this.isProduction = this.nodeEnv === 'production';
    this.isTest = this.nodeEnv === 'test';
  }

  // Backend API Configuration
  get apiConfig() {
    return {
      port: process.env.PORT || (this.isDevelopment ? 3001 : 3000),
      host: process.env.HOST || (this.isProduction ? '0.0.0.0' : 'localhost'),
      corsOrigins: this.isDevelopment 
        ? ['http://localhost:3000', 'http://localhost:3001'] 
        : ['https://realmkin.com', 'https://www.realmkin.com']
    };
  }

  // Database Configuration
  get databaseConfig() {
    return {
      // Firebase config is handled by environment variables
      retryAttempts: this.isDevelopment ? 3 : 5,
      retryDelay: this.isDevelopment ? 1000 : 2000,
    };
  }

  // Periodic Services Configuration
  get periodicServicesConfig() {
    return {
      // Disable periodic verification in development to improve performance
      enablePeriodicVerification: !this.isDevelopment,
      enablePeriodicBoosterRefresh: !this.isDevelopment,
      enablePeriodicGoalCheck: !this.isDevelopment,
      
      // Intervals (in milliseconds)
      verificationInterval: this.isDevelopment ? 60000 : 300000, // 1min dev, 5min prod
      boosterRefreshInterval: this.isDevelopment ? 300000 : 900000, // 5min dev, 15min prod
      goalCheckInterval: this.isDevelopment ? 30000 : 60000, // 30sec dev, 1min prod
      
      // Batch sizes for processing
      verificationBatchSize: this.isDevelopment ? 10 : 50,
      boosterRefreshBatchSize: this.isDevelopment ? 5 : 25,
    };
  }

  // Logging Configuration
  get loggingConfig() {
    return {
      level: this.isDevelopment ? 'debug' : 'info',
      enableConsoleLogging: true,
      enableFileLogging: !this.isDevelopment,
      logDirectory: './logs',
      maxLogSize: '10MB',
      maxLogFiles: this.isDevelopment ? 3 : 10,
    };
  }

  // Caching Configuration
  get cacheConfig() {
    return {
      boosterCacheTTL: this.isDevelopment ? 60000 : 300000, // 1min dev, 5min prod
      nftCacheTTL: this.isDevelopment ? 300000 : 1800000, // 5min dev, 30min prod
      priceCacheTTL: this.isDevelopment ? 30000 : 60000, // 30sec dev, 1min prod
      maxCacheSize: this.isDevelopment ? 100 : 1000,
    };
  }

  // Rate Limiting Configuration
  get rateLimitConfig() {
    return {
      windowMs: this.isDevelopment ? 60000 : 900000, // 1min dev, 15min prod
      maxRequests: this.isDevelopment ? 100 : 50,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    };
  }

  // Network Configuration
  get networkConfig() {
    const isDevnet = this.isDevelopment || process.env.SOLANA_NETWORK === 'devnet';
    
    return {
      isDevnet,
      cluster: isDevnet ? 'devnet' : 'mainnet',
      tokenMint: isDevnet
        ? process.env.MKIN_TOKEN_MINT_DEVNET || 'CARXmxarjsCwvzpmjVB2x4xkAo8fMgsAVUBPREoUGyZm'
        : process.env.MKIN_TOKEN_MINT_MAINNET || 'BKDGf6DnDHK87GsZpdWXyBqiNdcNb6KnoFcYbWPUhJLA',
      // Prioritize Helius RPC endpoints, fallback to public endpoints
      rpcUrl: isDevnet
        ? process.env.HELIUS_DEVNET_RPC_URL || process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com'
        : process.env.HELIUS_MAINNET_RPC_URL || process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
      heliusUrl: isDevnet
        ? process.env.HELIUS_DEVNET_RPC_URL
        : process.env.HELIUS_MAINNET_RPC_URL,
      streamflowProgramId: isDevnet
        ? process.env.STREAMFLOW_PROGRAM_ID_DEVNET || 'stkrJWxNgZqVv7N1CECmA7KszzG5Uy3Lw1x3yJvJzYQ'
        : process.env.STREAMFLOW_PROGRAM_ID_MAINNET || 'streamb6EciQvBQwFv6wrZjGsZjBMg6yT1J8eWkFQ1hYg'
    };
  }

  // Solana Configuration (legacy - use networkConfig instead)
  get solanaConfig() {
    const networkConfig = this.networkConfig;
    return {
      rpcUrl: networkConfig.rpcUrl,
      commitment: this.isDevelopment ? 'confirmed' : 'finalized',
      maxRetries: this.isDevelopment ? 3 : 5,
      retryDelay: this.isDevelopment ? 1000 : 2000,
    };
  }

  // Feature Flags
  get featureFlags() {
    return {
      enableDebugEndpoints: this.isDevelopment,
      enableHealthCheck: true,
      enableMetrics: !this.isDevelopment,
      enableScheduledJobs: !this.isDevelopment,
      enableBoosterSystem: true,
      enableGoalSystem: true,
      enableStakingSystem: true,
    };
  }

  // Security Configuration
  get securityConfig() {
    return {
      enableRateLimiting: !this.isDevelopment,
      enableCORS: true,
      enableHelmet: !this.isDevelopment,
      sessionSecret: process.env.SESSION_SECRET || (this.isDevelopment ? 'dev-secret' : undefined),
      jwtSecret: process.env.JWT_SECRET || (this.isDevelopment ? 'dev-jwt-secret' : undefined),
      tokenExpiry: this.isDevelopment ? '24h' : '1h',
    };
  }

  // Helper method to get current environment info
  getEnvironmentInfo() {
    return {
      nodeEnv: this.nodeEnv,
      isDevelopment: this.isDevelopment,
      isProduction: this.isProduction,
      isTest: this.isTest,
      timestamp: new Date().toISOString(),
    };
  }

  // Helper method to validate required environment variables
  validateRequiredEnvVars() {
    // Check for Firebase credentials (accept alternative methods)
    const hasFirebaseIndividual = process.env.FIREBASE_PROJECT_ID && 
                                   process.env.FIREBASE_CLIENT_EMAIL && 
                                   process.env.FIREBASE_PRIVATE_KEY;
    const hasFirebaseAlternative = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                                    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const hasFirebase = hasFirebaseIndividual || hasFirebaseAlternative;

    const required = this.isProduction ? [
      'STAKING_WALLET_ADDRESS',
      'STAKING_PRIVATE_KEY',
      'SESSION_SECRET',
      'JWT_SECRET',
    ] : [];

    const missing = required.filter(key => !process.env[key]);
    
    // Check Firebase separately
    if (!hasFirebase) {
      const envType = this.isProduction ? 'Production' : this.isDevelopment ? 'Development' : 'Test';
      console.warn(`⚠️ ${envType} environment - missing Firebase credentials`);
      console.log('💡 Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON in .env');
      
      if (this.isProduction) {
        missing.push('Firebase credentials (GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON)');
      }
    }
    
    if (missing.length > 0) {
      const envType = this.isProduction ? 'Production' : this.isDevelopment ? 'Development' : 'Test';
      console.warn(`⚠️ ${envType} environment - missing recommended environment variables: ${missing.join(', ')}`);
      console.log('💡 Set these variables in your .env file for full functionality');
      
      // Only throw error in production for missing critical vars
      if (this.isProduction) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
      }
    } else {
      const envType = this.isProduction ? 'Production' : this.isDevelopment ? 'Development' : 'Test';
      console.log(`✅ ${envType} environment - all required variables present`);
    }
  }
}

// Create and export singleton instance
const environmentConfig = new EnvironmentConfig();

export default environmentConfig;