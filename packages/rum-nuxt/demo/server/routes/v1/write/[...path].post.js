import { setResponseStatus } from 'h3'

export default defineEventHandler(function (event) {
  setResponseStatus(event, 204)
  return null
})
