import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set. Gatekeeper cannot connect to Postgres.')
}

// Decide SSL mode: require in non-local envs unless explicitly disabled via sslmode=disable
let sslOption = undefined
let disablePrepare = false
try {
  const url = new URL(connectionString)
  const host = (url.hostname || '').toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const sslmode = url.searchParams.get('sslmode')
  const forceRequire = !isLocal && (sslmode ? sslmode !== 'disable' : true)
  sslOption = forceRequire ? 'require' : undefined

  // If using PgBouncer (common on Supabase pooler port 6543), disable prepared statements
  const port = Number(url.port || '5432')
  const pgbouncerFlag = (url.searchParams.get('pgbouncer') || '').toLowerCase() === 'true'
  if (port === 6543 || pgbouncerFlag) {
    disablePrepare = true
  }
} catch {
  // If URL parsing fails, default to requiring SSL (safe for most managed providers)
  sslOption = 'require'
}

// Tune timeouts to fail fast and avoid hanging
const sql = postgres(connectionString, {
  connect_timeout: 10, // seconds
  idle_timeout: 30,    // seconds
  max: 10,             // pool size
  ssl: sslOption,
  // Disable prepared statements when behind transaction poolers like PgBouncer
  prepare: disablePrepare ? false : undefined,
})

export default sql
