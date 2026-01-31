/**
 * Discord Alert Utility
 * Sends critical alerts to admin Discord channel via webhook
 */

/**
 * Send alert to Discord webhook
 * @param {Object} options - Alert options
 * @param {string} options.level - Alert level: 'INFO', 'WARNING', 'CRITICAL', 'ERROR'
 * @param {string} options.title - Alert title
 * @param {string} options.message - Alert message
 * @param {string} options.action - Recommended action (optional)
 * @param {Object} options.details - Additional details (optional)
 */
export async function sendDiscordAlert({ level = 'INFO', title, message, action, details }) {
  const webhookUrl = process.env.DISCORD_ADMIN_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('⚠️  DISCORD_ADMIN_WEBHOOK_URL not set - skipping Discord alert');
    console.log(`[${level}] ${title}: ${message}`);
    return false;
  }

  // Color codes for different alert levels
  const colors = {
    INFO: 3447003,      // Blue
    WARNING: 16776960,  // Yellow/Gold
    CRITICAL: 15158332, // Red
    ERROR: 10038562     // Dark Red
  };

  // Emoji for different levels
  const emojis = {
    INFO: 'ℹ️',
    WARNING: '⚠️',
    CRITICAL: '🚨',
    ERROR: '❌'
  };

  const embed = {
    title: `${emojis[level]} ${title}`,
    description: message,
    color: colors[level],
    fields: [],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Realmkin Staking System'
    }
  };

  // Add action field if provided
  if (action) {
    embed.fields.push({
      name: '🎯 Action Required',
      value: action,
      inline: false
    });
  }

  // Add details fields if provided
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      embed.fields.push({
        name: key,
        value: String(value),
        inline: true
      });
    }
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed],
        // Mention admins for critical alerts
        content: level === 'CRITICAL' ? '@here' : undefined
      })
    });

    if (!response.ok) {
      console.error('Failed to send Discord alert:', response.status, response.statusText);
      return false;
    }

    console.log(`✅ Discord alert sent: [${level}] ${title}`);
    return true;

  } catch (error) {
    console.error('Error sending Discord alert:', error);
    return false;
  }
}

/**
 * Send critical vault alert
 */
export async function sendVaultCriticalAlert(solBalance) {
  return sendDiscordAlert({
    level: 'CRITICAL',
    title: 'Vault SOL Critically Low!',
    message: `The staking vault has critically low SOL balance. Unstake operations will fail if not topped up immediately.`,
    action: `Send SOL to vault: \`${process.env.STAKING_WALLET_ADDRESS}\`\n\nCommand:\n\`\`\`bash\nsolana transfer ${process.env.STAKING_WALLET_ADDRESS} 0.1\n\`\`\``,
    details: {
      'Current Balance': `${solBalance.toFixed(6)} SOL`,
      'Minimum Required': '0.01 SOL',
      'Recommended': '0.1 SOL',
      'Status': '🔴 CRITICAL'
    }
  });
}

/**
 * Send warning vault alert
 */
export async function sendVaultWarningAlert(solBalance) {
  return sendDiscordAlert({
    level: 'WARNING',
    title: 'Vault SOL Getting Low',
    message: `The staking vault SOL balance is getting low. Please plan to top up soon to prevent service disruption.`,
    action: `Monitor and top up when convenient:\n\`\`\`bash\nsolana transfer ${process.env.STAKING_WALLET_ADDRESS} 0.1\n\`\`\``,
    details: {
      'Current Balance': `${solBalance.toFixed(6)} SOL`,
      'Warning Threshold': '0.05 SOL',
      'Status': '🟡 WARNING'
    }
  });
}

/**
 * Send failed unstake alert
 */
export async function sendFailedUnstakeAlert({ userId, amount, error }) {
  return sendDiscordAlert({
    level: 'ERROR',
    title: 'Unstake Failed - Manual Recovery Needed',
    message: `An unstake operation failed after the user paid the fee. Manual intervention required to send tokens.`,
    action: `Run manual recovery script:\n\`\`\`bash\nnode gatekeeper/scripts/recover-failed-unstake.js ${userId}\n\`\`\``,
    details: {
      'User ID': userId,
      'Amount': `${amount.toLocaleString()} MKIN`,
      'Error': error,
      'Status': '❌ NEEDS RECOVERY'
    }
  });
}

/**
 * Send recovery success alert
 */
export async function sendRecoverySuccessAlert({ userId, amount, signature }) {
  return sendDiscordAlert({
    level: 'INFO',
    title: 'Unstake Recovery Successful',
    message: `Successfully recovered failed unstake for user.`,
    details: {
      'User ID': userId,
      'Amount': `${amount.toLocaleString()} MKIN`,
      'Transaction': signature,
      'Status': '✅ RECOVERED'
    }
  });
}

export default {
  sendDiscordAlert,
  sendVaultCriticalAlert,
  sendVaultWarningAlert,
  sendFailedUnstakeAlert,
  sendRecoverySuccessAlert
};
