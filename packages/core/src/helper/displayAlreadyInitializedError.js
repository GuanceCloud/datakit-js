import { display } from './display'

export function displayAlreadyInitializedError(sdkName, initConfiguration) {
  if (!initConfiguration.silentMultipleInit) {
    display.error(sdkName + ' is already initialized.')
  }
}
