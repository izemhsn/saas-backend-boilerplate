// 4-parameter signature = Express recognizes this as error middleware
// (_next is required to keep the arity even though it is unused)
export const errorHandler = (err, req, res, _next) => {
  console.error(err.stack)

  const statusCode = err.statusCode ?? 500
  const isProduction = process.env.NODE_ENV === 'production'
  const message = statusCode >= 500 && isProduction ? 'Internal Server Error' : err.message ?? 'Internal Server Error'

  res.status(statusCode).json({
    success: false,
    message,
    // Show stack trace only in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
