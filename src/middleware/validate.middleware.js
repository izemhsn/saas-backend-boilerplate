// Higher-order function: returns a middleware that validates with schema
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body:   req.body,
    query:  req.query,
    params: req.params,
  })

  if (!result.success) {
    return res.status(400).json({
      success: false,
      errors: result.error.flatten().fieldErrors,
    })
  }

  req.validated = result.data // use req.validated.body in controllers
  next()
}