import { createRouter as originalCreateRouter } from 'vue-router'
import { wrapCreateRouter } from '../domain/vueRouter'

export var createRouter = wrapCreateRouter(originalCreateRouter)
