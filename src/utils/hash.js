import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

// Precomputed hash of a random string, used to run a real bcrypt compare
// when a user is not found so login timing doesn't reveal email existence.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalization', SALT_ROUNDS)

export const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS)

export const comparePassword = (password, hash) => bcrypt.compare(password, hash)

export const dummyCompare = () => bcrypt.compare('invalid', DUMMY_HASH)
