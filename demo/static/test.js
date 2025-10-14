// export * from './a'
// export * from './b'
// export * from './c'
import { objectHasValue, heavyComputation } from './b'

document.getElementById('longtask_button').addEventListener('click', () => {
  let start = Date.now()
  while (Date.now() - start < 100) {
    // block main thread for 100ms
  }
  console.log('long task done')
})
document
  .getElementById('longtask_button_func_name')
  .addEventListener('click', () => {
    heavyComputation('test')
  })

objectHasValue('xxx')
