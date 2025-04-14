# Custom Addition of Extra Data TAG

---

After initializing RUM, use the `setGlobalContextProperty(key:string, value:any)` API to add extra TAGs to all RUM events collected from the application.

### Adding TAGs

=== "CDN Sync"

    ```javascript
    window.DATAFLUX_RUM && window.DATAFLUX_RUM.setGlobalContextProperty('<CONTEXT_KEY>', '<CONTEXT_VALUE>');

    // Code example
    window.DATAFLUX_RUM && window.DATAFLUX_RUM.setGlobalContextProperty('isvip', 'xxxx');
    window.DATAFLUX_RUM && window.DATAFLUX_RUM.setGlobalContextProperty('activity', {
        hasPaid: true,
        amount: 23.42
    });
    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setGlobalContextProperty('<CONTEXT_KEY>', '<CONTEXT_VALUE>');
    })

    // Code example
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setGlobalContextProperty('isvip', 'xxxx');
    })
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setGlobalContextProperty('activity', {
            hasPaid: true,
            amount: 23.42
        });
    })

    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'
    datafluxRum.setGlobalContextProperty('<CONTEXT_KEY>', <CONTEXT_VALUE>);

    // Code example
    datafluxRum && datafluxRum.setGlobalContextProperty('isvip', 'xxxx');
    datafluxRum.setGlobalContextProperty('activity', {
        hasPaid: true,
        amount: 23.42
    });
    ```

### Replacing TAGs (Overwrite)

=== "CDN Sync"

    ```javascript
    window.DATAFLUX_RUM &&
        DATAFLUX_RUM.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });

    // Code example
    window.DATAFLUX_RUM &&
        DATAFLUX_RUM.setGlobalContext({
            codeVersion: 34,
        });
    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });
    })

    // Code example
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setGlobalContext({
            codeVersion: 34,
        })
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    datafluxRum.setGlobalContext({ '<CONTEXT_KEY>': '<CONTEXT_VALUE>' });

    // Code example
    datafluxRum.setGlobalContext({
        codeVersion: 34,
    });
    ```

### Getting All Set Custom TAGs

=== "CDN Sync"

    ```javascript
    var context = window.DATAFLUX_RUM && DATAFLUX_RUM.getGlobalContext();

    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        var context = DATAFLUX_RUM.getGlobalContext();
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    const context = datafluxRum.getGlobalContext();

    ```

### Removing Specific Key Corresponding Custom TAG

=== "CDN Sync"

    ```javascript
    var context = window.DATAFLUX_RUM && DATAFLUX_RUM.removeGlobalContextProperty('<CONTEXT_KEY>');

    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        var context = DATAFLUX_RUM.removeGlobalContextProperty('<CONTEXT_KEY>');
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    const context = datafluxRum.removeGlobalContextProperty('<CONTEXT_KEY>');
    ```

### Removing All Custom TAGs

=== "CDN Sync"

    ```javascript
    var context = window.DATAFLUX_RUM && DATAFLUX_RUM.clearGlobalContext();

    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        var context = DATAFLUX_RUM.clearGlobalContext();
    });
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'

    const context = datafluxRum.clearGlobalContext();
    ```
