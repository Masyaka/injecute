/**
 * - TODO: Fix ObjectKeyOfType<TServices, T> to constraint allowed aliases for type in addAlias method. (ᅌᴗᅌ* )=Э  Forgot why we need this
 *
 * - TODO: Add lazy wrapper for function. Wrapped function should not execute any code or retrieve services from container before function call.
 *
 * - TODO: Add memoize option to transient services which will return new instance if dependencies is changed. Memoization should not lead to checks of every dependency on get, but if dependency changed - use some mark or callback for instances invalidation
 *
 * - TODO: Add dedicated utils for list services and see their dependencies
 *
 * - TODO: Add description option when services added. (ᅌᴗᅌ* )=Э  Forgot why we need this
 *
 * - TODO: ~~Manage Promise and async dependencies:
 *     If some of dependencies is registered as promise, result of current registering service will be async,
 *     but factory can be sync or constructor~~
 *
 * - TODO: Add auto resolvers with typescript parser.
 *
 * - TODO: Add reset method for specific singleton and his dependants.
 *
 * - TODO: Add typescript to 5.x decorators support. Decorators should be retrieved from the container.
 *
 * - TODO: ~~Add arguments names param truly optional or required. Can be done with types.~~
 *
 * - TODO: Change preload util to await async services and change result type of container
 *
 * - TODO: Add services utilization on reset, add dispose option which is callback on reset.
 *
 * - TODO: Add lifetime option, which will remove singleton instance after time is up.
 *
 * - TODO: Update readme
 *
 * - TODO: Support child container first resolving strategy.
 *
 * - TODO: Proxy util can be changed to util which creates object and container.keys -> Object.defineProperty; onAdd -> defineProperty. it will allow to list specific keys to be accessible or with aliases.
 * 
 * - TODO: Split container interface to "adding" part and "utitilies" it should help to keep container details out of typechecks.
 *
 * - TODO: Add possibility to override some of dependencies for specific service
 *
 * It can be done by collecting vertical projection of existing instances and factories.
 * Steps:
 *   - 1) Collect all needed dependencies. Instances (i) and factories (f) independent.
 *   - 2) Resolve each dependency independently starting from current container and moving to parent if not resolved in current.
 *   - 3) Run factories (f) to get missing instances
 *   - 4) Instantiate requested service using ready to use instances (i).
 *
 * | containers | dep1  | dep2  | dep3  | dep4  |
 * -------------|:-----:|:-----:|:-----:|:-----:|
 * | root       |       |   f   |       |       |
 * -------------|:-----:|:-----:|:-----:|:-----:|
 * | child1     |   i   |   .   |   f   |       |
 * -------------|:-----:|:-----:|:-----:|:-----:|
 * | child2     |   .   |   .   |   .   |   i   |
 * -------------|:-----:|:-----:|:-----:|:-----:|
 *
 *
 * - TODO: add external dynamic services config.
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
type Todos = string;
