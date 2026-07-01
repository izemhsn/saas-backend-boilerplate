import app from './app.js'

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET']
const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const PORT = process.env.PORT ?? 3000

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})