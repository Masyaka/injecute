

/**
 * TODO: Add preload function.
 * TODO: Add decorators services registering strategy
 * TODO: Fix ObjectKeyOfType<TServices, T> to constraint allowed aliases for type in addAlias method
 * todo: Add lazy wrapper for function. Wrapped function should not execute any code or retrieve services from container before function call.
 * todo: Use Map for as storages
 * todo: Add addMemoized add service option which will return new instance if dependencies is changed
 * todo: Add dedicated utils for list services and see their dependencies
 * todo: Add description option when services added
 * todo: Remove implicit constructors support. Add `instantiate(Constructor)` helper for this purposes.
 * todo: Add auto resolvers with typescript parser.
 * todo: Add reset method which will erase singletons instances. For example: to have possibility recreate instances using replaced services.
 * todo: Update typescript to 5.x and add decorators support. Decorators should be retrieved from the container.
 * todo: Add namespace feature.
 * todo: Add arguments names param truly optional or required.
 *  @example
 * ```typescript
 * container.addNamespace(namespace: string): IDIContainer. // probably namespace container should know about parent container and register services in it when receives registration.
 * container.addNamespace('FooDomain').extend(addFooDomainServices);
 * container.get('FooDomain.fooService')
 * ```
 *
 * TODO: Support child container first resolving strategy.
 * It can be done by collecting vertical projection of existing instances and factories.
 * Steps:
 * 1) Collect all needed dependencies. Instances (i) and factories (f) independent.
 * 2) Resolve each dependency independently starting from current container and moving to parent if not resolved in current.
 * 3) Run factories (f) to get missing instances
 * 4) Instantiate requested service using ready to use instances (i).
 *
 * containers | dep1  | dep2  | dep3  | dep4
 * --------------------------------------
 * root       |       |   f   |       |
 * child1     |   i   |   .   |   f   |
 * child2     |   .   |   .   |   .   |   i
 *
 * TODO: add external dynamic services config.
 * It can be implemented by adding new arguments resolvers
 * .yml or .json like this:
 * @example
 * ```json
 * {
 *   winstonLogger: ['devLoggerTransports'] // use dev transports for winstonLogger
 *   logger: 'winstonLogger', // use winston as default logger
 *   notificationService: 'slackNotificationService' // use slack service as notificationService
 * }
 * ```
 */
