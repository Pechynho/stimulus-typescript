import {Context, Controller} from "@hotwired/stimulus";
import Portal from "./portal-controller";

class Wrapped<T = any>
{
    private _: T | undefined = undefined;

    public constructor(
        public readonly context: 'typed-object' | 'typed-array' | 'target',
    ) {
    }
}

export const TypedObject = <T extends object>() => new Wrapped<T>('typed-object');

export const TypedArray = <T>() => new Wrapped<T[]>('typed-array');

export const Target = <T extends object>() => new Wrapped<T>('target');

type Constructor<T = {}> = new (...args: any[]) => T;

type ControllerConstructor<T extends Element> = new (context: Context) => Controller<T>;

type ControllerElementType<C> = C extends Controller<infer E> ? E : never;

type CamelCase<K extends string> =
    K extends `${infer T}_${infer U}`
        ? `${Uncapitalize<T>}${Capitalize<CamelCase<U>>}`
        : K extends `${infer T}-${infer U}`
            ? `${Uncapitalize<T>}${Capitalize<CamelCase<U>>}`
            : K extends `${infer T} ${infer U}`
                ? `${Uncapitalize<T>}${Capitalize<CamelCase<U>>}`
                : K;

type ClassProperties<Classes extends readonly string[] = []> =
    { [K in Classes[number] as `${CamelCase<K>}Class`]: string } &
    { readonly [K in Classes[number] as `has${Capitalize<CamelCase<K>>}Class`]: boolean } &
    { [K in Classes[number] as `${CamelCase<K>}Classes`]: string[] };

type ValueTypeDefault = Array<any> | boolean | number | Object | typeof Wrapped | string;

type ValueTypeConstant =
    | typeof Array<any>
    | typeof Boolean
    | typeof Number
    | typeof TypedObject
    | typeof String
    | typeof Wrapped;

type ValueTypeObject = {
    type: ValueTypeConstant;
    default?: ValueTypeDefault;
};

type ValueTypeDefinition = ValueTypeConstant | ValueTypeObject | InstanceType<Wrapped>;

type ValueDefinitionMap = {
    [token: string]: ValueTypeDefinition;
};

type TypeFromConstructor<C> =
    C extends StringConstructor
        ? string
        : C extends NumberConstructor
            ? number
            : C extends BooleanConstructor
                ? boolean
                : C extends ArrayConstructor
                    ? any[]
                    : C extends Wrapped<infer T>
                        ? T
                        : C extends ObjectConstructor
                            ? Object
                            : C extends Constructor<infer T>
                                ? TypeFromConstructor<T>
                                : never;

type TransformValueDefinition<T extends ValueTypeDefinition> =
    T extends { type: infer U }
        ? TypeFromConstructor<U>
        : TypeFromConstructor<T>;

type ValuesProperties<Values extends ValueDefinitionMap> =
    { [K in keyof Values as `${CamelCase<K & string>}Value`]: TransformValueDefinition<Values[K]> } &
    { readonly [K in keyof Values as `has${Capitalize<CamelCase<K & string>>}Value`]: boolean };

type TargetTypeDefinition = typeof Element | InstanceType<Wrapped>;

type TargetsDefinitionMap = {
    [token: string]: TargetTypeDefinition;
};

type TransformTargetDefinition<T extends TargetTypeDefinition> =
    T extends Wrapped<infer U>
        ? U
        : InstanceType<T>;

type TargetsProperties<Targets extends TargetsDefinitionMap> =
    { readonly [K in keyof Targets as `${CamelCase<K & string>}Target`]: TransformTargetDefinition<Targets[K]> } &
    { readonly [K in keyof Targets as `has${Capitalize<CamelCase<K & string>>}Target`]: boolean } &
    { readonly [K in keyof Targets as `${CamelCase<K & string>}Targets`]: TransformTargetDefinition<Targets[K]>[] };

type OutletsDefinitionMap = {
    [token: string]: Constructor<Controller>;
};

type OutletProperties<Outlets extends OutletsDefinitionMap> =
    { readonly [K in keyof Outlets as `${CamelCase<K & string>}Outlet`]: InstanceType<Outlets[K]> } &
    { readonly [K in keyof Outlets as `has${Capitalize<CamelCase<K & string>>}Outlet`]: boolean } &
    { readonly [K in keyof Outlets as `${CamelCase<K & string>}Outlets`]: InstanceType<Outlets[K]>[] };

type PortalProperties<Portals extends true | undefined> =
    Portals extends boolean
        ? {
            readonly portalOutlet: Portal;
            readonly hasPortalOutlet: boolean;
            readonly portalOutlets: Portal[];
            portalSelectorsValue: string[];
            readonly hasPortalSelectorsValue: boolean;
        }
        : {};

function PortalsMixin<Base extends ControllerConstructor<ControllerElementType<Controller>> = ControllerConstructor<ControllerElementType<Controller>>>(Base: Base): Base {
    return class extends Base
    {
        constructor(context: Context) {
            super(context);

            const portalOutlets: Set<Portal> = new Set();

            const originalDisconnect = (this as any).disconnect;
            (this as any).disconnect = function (): void {
                if (portalOutlets.size > 0) {
                    for (const outlet of portalOutlets) {
                        outlet.unsync(this);
                    }
                    portalOutlets.clear();
                }
                if (typeof originalDisconnect === 'function') {
                    originalDisconnect.call(this);
                }
            };

            const originalPortalOutletConnected = (this as any).portalOutletConnected;
            (this as any).portalOutletConnected = function (outlet: Portal, element: HTMLElement): void {
                outlet.sync(this);
                portalOutlets.add(outlet);
                if (typeof originalPortalOutletConnected === 'function') {
                    originalPortalOutletConnected.call(this, outlet, element);
                }
            };

            const originalPortalOutletDisconnected = (this as any).portalOutletDisconnected;
            (this as any).portalOutletDisconnected = function (outlet: Portal, element: HTMLElement): void {
                outlet.unsync(this);
                portalOutlets.delete(outlet);
                if (typeof originalPortalOutletDisconnected === 'function') {
                    originalPortalOutletDisconnected.call(this, outlet, element);
                }
            };

            const originalPortalSelectorsValueChanged = (this as any).portalSelectorsValueChanged;
            (this as any).portalSelectorsValueChanged = function (value: string[], previousValue: string[]): void {
                const outletAttribute = `data-${this.identifier}-portal-outlet`;
                if (value.length > 0) {
                    const controllerAttribute = this.context.schema.controllerAttribute;
                    const selector = value.join(', ');
                    const portalElements = document.querySelectorAll(selector);
                    for (const portalElement of portalElements) {
                        if (!portalElement.hasAttribute(controllerAttribute)) {
                            portalElement.setAttribute(controllerAttribute, 'portal');
                            continue;
                        }
                        const existingControllers = portalElement.getAttribute(controllerAttribute)!.split(' ');
                        if (!existingControllers.includes('portal')) {
                            existingControllers.push('portal');
                            portalElement.setAttribute(controllerAttribute, existingControllers.join(' '));
                        }
                    }
                    if (!this.element.hasAttribute(outletAttribute)) {
                        this.element.setAttribute(outletAttribute, selector);
                    } else if (this.element.getAttribute(outletAttribute) !== selector) {
                        this.element.setAttribute(outletAttribute, selector);
                    }
                } else if (this.element.hasAttribute(outletAttribute)) {
                    this.element.removeAttribute(outletAttribute);
                }
                if (typeof originalPortalSelectorsValueChanged === 'function') {
                    originalPortalSelectorsValueChanged.call(this, value, previousValue);
                }
            }
        }
    } as Base;
}

type Configuration<
    Values extends ValueDefinitionMap,
    Targets extends TargetsDefinitionMap,
    Classes extends readonly string[],
    Outlets extends OutletsDefinitionMap,
    Portals extends true | undefined,
> = {
    values?: Values;
    targets?: Targets;
    classes?: Classes;
    outlets?: Outlets;
    portals?: Portals;
};

function patchValueTypeDefinitionMap(values: ValueDefinitionMap): ValueDefinitionMap {
    const patchedValues: ValueDefinitionMap = {};
    const pathType = (type: any) => {
        if (type instanceof Wrapped && type.context === 'typed-object') {
            return Object;
        }
        if (type instanceof Wrapped && type.context === 'typed-array') {
            return Array;
        }
        return type;
    };
    Object.getOwnPropertyNames(values).forEach(key => {
        const definition = values[key];
        if (typeof definition === 'object' && 'default' in definition && 'type' in definition) {
            patchedValues[key] = {
                type: pathType(definition.type),
                default: definition.default,
            };
        } else if (typeof definition === 'object' && 'type' in definition) {
            patchedValues[key] = pathType(definition.type);
        } else if (definition instanceof Wrapped) {
            patchedValues[key] = pathType(definition);
        } else {
            patchedValues[key] = definition;
        }
    });
    return patchedValues;
}

export function Typed<
    Values extends ValueDefinitionMap = {},
    Targets extends TargetsDefinitionMap = {},
    Classes extends readonly string[] = [],
    Outlets extends OutletsDefinitionMap = {},
    Portals extends true | undefined = undefined,
    Base extends ControllerConstructor<ControllerElementType<Controller>> = ControllerConstructor<ControllerElementType<Controller>>,
>(Base: Base, configuration: Configuration<Values, Targets, Classes, Outlets, Portals> = {}) {
    const {values, targets, classes, outlets, portals} = configuration;

    const patchedOutlet = Object.getOwnPropertyNames(outlets ?? {});

    const patchedValues = patchValueTypeDefinitionMap(values ?? {});

    if (portals === true) {
        patchedOutlet.push('portal');
        if (typeof patchedValues['portalSelectors'] === 'undefined') {
            patchedValues['portalSelectors'] = {type: TypedArray<string>, default: []};
        }
    }

    let derived = class extends Base
    {
        static values = patchedValues;
        static targets = Object.getOwnPropertyNames(targets ?? {});
        static classes = classes ?? [];
        static outlets = patchedOutlet;
    };

    if (portals === true) {
        derived = PortalsMixin(derived as Base) as typeof derived;
    }

    return derived as typeof Base & {
        new(context: Context): InstanceType<Base>
            & ValuesProperties<Values>
            & TargetsProperties<Targets>
            & ClassProperties<Classes>
            & OutletProperties<Outlets>
            & PortalProperties<Portals>;
    }
}
