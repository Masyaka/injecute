/**
 * - TODO: Fix ObjectKeyOfType<TServices, T> to constraint allowed aliases for type in addAlias method. (ᅌᴗᅌ* )=Э  Forgot why we need this
 *
 * - todo: Add lazy wrapper for function. Wrapped function should not execute any code or retrieve services from container before function call.
 *
 * - todo: Add memoize option to transient services which will return new instance if dependencies is changed
 *
 * - todo: Add dedicated utils for list services and see their dependencies
 *
 * - todo: Add description option when services added. (ᅌᴗᅌ* )=Э  Forgot why we need this
 *
 * - todo: Manage Promise and async dependencies:
 *     If some of dependencies is registered as promise, result of current registering service will be async,
 *     but factory can be sync or constructor
 *
 * - todo: Add auto resolvers with typescript parser.
 *
 * - todo: Add reset method for specific singleton and his dependencies.
 *
 * - todo: Update typescript to 5.x and add decorators support. Decorators should be retrieved from the container.
 *
 * - todo: Add arguments names param truly optional or required.
 *
 * - todo: Change preload util to await async services and change result type of container
 *
 * - todo: Add services utilization on reset, add dispose option which is callback on reset.
 *
 * - todo: Add lifetime option, which will remove singleton instance after time is up.
 *
 * - todo: Update readme
 *
 * - TODO: Support child container first resolving strategy.
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
