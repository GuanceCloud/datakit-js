import { createRouter as originalCreateRouter } from '@tanstack/react-router'
import { wrapCreateRouter } from '../domain/tanstackRouter'

export var createRouter = wrapCreateRouter(originalCreateRouter)
