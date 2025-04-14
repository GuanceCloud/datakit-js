# Custom User Identifiers

---

By default, the SDK automatically generates a unique identifier ID for users. This ID does not carry any identifying attributes and can only distinguish between different user properties. Therefore, we provide additional APIs to add different identifying attributes to the current user.

| Property   | Type   | Description               |
| ---------- | ------ | ------------------------- |
| user.id    | string | User ID                   |
| user.name  | string | User nickname or username |
| user.email | string | User email                |

**Note**: The following properties are optional, but it is recommended to provide at least one of them.

### Adding User Identifiers

=== "CDN Sync"

    ```javascript
    window.DATAFLUX_RUM && window.DATAFLUX_RUM.setUser({
        id: '1234',
        name: 'John Doe',
        email: 'john@doe.com',
    })
    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.setUser({
            id: '1234',
            name: 'John Doe',
            email: 'john@doe.com',
        })
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'
    datafluxRum.setUser({
        id: '1234',
        name: 'John Doe',
        email: 'john@doe.com',
    })
    ```

### Removing User Identifiers

=== "CDN Sync"

    ```javascript
    window.DATAFLUX_RUM && window.DATAFLUX_RUM.clearUser()
    ```

=== "CDN Async"

    ```javascript
    DATAFLUX_RUM.onReady(function() {
        DATAFLUX_RUM.clearUser()
    })
    ```

=== "NPM"

    ```javascript
    import { datafluxRum } from '@cloudcare/browser-rum'
    datafluxRum.clearUser()
    ```
