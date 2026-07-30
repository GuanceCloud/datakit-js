import OriginalVueRouter from 'vue-router'
import { wrapRouterConstructor } from '../domain/vueRouter'

var VueRouter = wrapRouterConstructor(OriginalVueRouter)

export { VueRouter }
export default VueRouter
