// 4-parameter signature = Express recognizes this as error middleware
export const errorHandler = (err, req, res, next) => {
  console.error(err.stack)

  const statusCode = err.statusCode ?? 500
  const message    = err.message ?? 'Internal Server Error'

  res.status(statusCode).json({
    success: false,
    message,
    // Show stack trace only in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}