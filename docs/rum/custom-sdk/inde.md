# Custom RUM SDK Data Collection

---

By default, the RUM SDK automatically collects Web data and uploads it to DataKit. In most application scenarios, there is no need to actively modify this data. However, in some specific scenarios, different types of identifiers are required to locate and analyze certain data. For these situations, the RUM SDK provides specific APIs that allow users to add their own custom logic within their application systems:

1. [Customize User Identification (ID, name, email)](./user-id.md)
2. [Add Custom Data TAGs](./add-additional-tag.md)
3. [Add Custom Actions](./add-action.md)
4. [Add Custom Errors](./add-error.md)
