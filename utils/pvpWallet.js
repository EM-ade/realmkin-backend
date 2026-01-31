import sql from '../db.js';

async function resolveUserUuidByDiscordId(discordId) {
  const rows = await sql`select user_id from user_links where discord_id = ${discordId}`;
  return rows[0]?.user_id || null;
}

// Unified ledger operations for staking & rewards
// Uses apply_ledger_entry(user_id uuid, delta bigint, reason text, refId text)

export async function deductStake(discordId, amount, sessionOrChallengeId, role) {
  const userId = await resolveUserUuidByDiscordId(discordId);
  if (!userId) throw new Error('user not linked');
  const refId = `pvp_stake:${sessionOrChallengeId}:${role}`;
  const reason = `pvp_stake_${role}`;
  // Negative delta to deduct
  const rows = await sql`
    select public.apply_ledger_entry(${userId}::uuid, ${-amount}::bigint, ${reason}, ${refId}) as balance
  `;
  return Number(rows[0]?.balance ?? 0);
}

export async function creditReward(discordId, amount, sessionId) {
  const userId = await resolveUserUuidByDiscordId(discordId);
  if (!userId) throw new Error('user not linked');
  const refId = `pvp_reward:${sessionId}`;
  const reason = 'pvp_reward';
  const rows = await sql`
    select public.apply_ledger_entry(${userId}::uuid, ${amount}::bigint, ${reason}, ${refId}) as balance
  `;
  return Number(rows[0]?.balance ?? 0);
}

export async function getBalance(discordId) {
  const rows = await sql`
    select ub.balance from user_balances ub
    join user_links ul on ul.user_id = ub.user_id
    where ul.discord_id = ${discordId}
  `;
  return Number(rows[0]?.balance ?? 0);
}
