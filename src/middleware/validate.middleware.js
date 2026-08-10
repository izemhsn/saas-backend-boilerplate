// Higher-order function: returns a middleware that validates with schema.
// If validation fails, error messages that look like i18n keys (contain a dot
// and no spaces) are translated via req.t(); plain-text messages pass through.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  })

  if (!result.success) {
    const flattened = result.error.flatten()
    // Translate any field error that is an i18n key (dot-notation, no spaces)
    const translateErrors = (errors) =>
      (errors || []).map((msg) => {
        if (typeof msg === 'string' && msg.includes('.') && !msg.includes(' ')) {
          return req.t(msg)
        }
        return msg
      })

    const translatedErrors = {}
    for (const [field, msgs] of Object.entries(flattened.fieldErrors)) {
      translatedErrors[field] = translateErrors(msgs)
    }

    return res.status(400).json({
      success: false,
      errors: translatedErrors,
    })
  }

  req.validated = result.data // use req.validated.body in controllers
  next()
}
