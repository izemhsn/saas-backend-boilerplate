// Translates a service result that may contain a `messageKey` field into a
// response-ready object with a `message` field. If the result has no
// `messageKey`, it's returned as-is.
//
// Usage in controllers:
//   const data = await someService.doThing(req.validated.body)
//   res.json({ success: true, data: translateResult(req, data) })
export const translateResult = (req, data) => {
  if (!data || typeof data !== 'object' || !data.messageKey) return data
  const { messageKey, params, ...rest } = data
  return { ...rest, message: req.t(messageKey, params) }
}
