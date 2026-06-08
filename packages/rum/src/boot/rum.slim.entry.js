import { makeRumRecorderApiStub } from './rumRecorderApiStub'
import { makeRumEntry } from './rumEntryFactory'
import { forceRumSlimConfiguration } from './rumSlimConfiguration'

export var datafluxRum = makeRumEntry(makeRumRecorderApiStub(), {
  overrideInitConfiguration: forceRumSlimConfiguration
})
