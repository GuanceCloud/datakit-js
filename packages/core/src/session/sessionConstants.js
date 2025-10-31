import { ONE_HOUR, ONE_MINUTE } from '../helper/tools'
export var SESSION_TIME_OUT_DELAY = 4 * ONE_HOUR
export var SESSION_EXPIRATION_DELAY = 15 * ONE_MINUTE
export var SESSION_STORE_KEY = '_gc_s'
export const SESSION_NOT_TRACKED = '0'
export const SessionPersistence = {
  COOKIE: 'cookie',
  LOCAL_STORAGE: 'local-storage'
}
