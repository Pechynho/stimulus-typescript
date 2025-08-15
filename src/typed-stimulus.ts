import {Context, Controller} from "@hotwired/stimulus";
import Portal from "./portal-controller";

// @ts-ignore
class Wrapped<T extends object>
{
    // @ts-ignore
    private _ = undefined;
}

/**
 * Strongly type Object values
 * ```ts
 * const values = {
 *  address: Object_<{ street: string }>
 * }
 * ```
 */
export const Object_ = Wrapped;
export const ObjectAs = Object_;
/**
 * Strongly type custom targets
 * ```ts
 * const targets = {
 *  select: Target<CustomSelect>
 * }
 * ```
 */
export const Target = Wrapped;

/**
 * Identifier to camel case (admin--user-status to adminUserStatus)
 */
type CamelCase<K extends string> = K extends `${infer Head}-${infer Tail}`
    ? `${Head}${Capitalize<CamelCase<Tail>>}`
    : K;

type ElementType<C> = C extends Controller<infer E> ? E : never;

type Singular<T, Suffix extends string> = {
    [K in keyof T as `${CamelCase<K & string>}${Suffix}`]: T[K];
};

type Existential<T, Suffix extends string> = {
    [K in keyof T as `has${Capitalize<CamelCase<K & string>>}${Suffix}`]: boolean;
};

type Plural<T, Suffix extends string> = {
    [K in keyof T as `${CamelCase<K & string>}${Suffix}s`]: T[K][];
};

type Elemental<T, Suffix extends string> = {
    [K in keyof T as `${CamelCase<K & string>}${Suffix}Element`]: ElementType<T[K]>;
} & {
    [K in keyof T as `${CamelCase<K & string>}${Suffix}Elements`]: ElementType<T[K]>[];
};

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type MagicProperties<T, Kind extends string> = (Kind extends "Value"
    ? Singular<T, Kind>
    : Readonly<Singular<T, Kind>>) &
    Readonly<Existential<T, Kind>> &
    Readonly<Kind extends "Target" | "Outlet" ? Plural<T, Kind> : unknown> &
    Readonly<Kind extends "Outlet" ? Elemental<T, Kind> : unknown>;

type Constructor<T = {}> = new (...args: any[]) => T;

type TypeFromConstructor<C> = C extends StringConstructor
    ? string
    : C extends NumberConstructor
        ? number
        : C extends BooleanConstructor
            ? boolean
            : C extends Constructor<infer T>
                ? T extends Wrapped<infer O>
                    ? O
                    : Object extends T
                        ? unknown
                        : T
                : never;

/**
 * Map `{ [key:string]: Constructor<T> } to { [key:string]: T }`
 */
type TransformType<T extends {}> = {
    [K in keyof T]: TypeFromConstructor<T[K]>;
};

/**
 * Transform `{ [key:string]: ValueTypeConstant | ValueTypeObject }`
 */
type TransformValueDefinition<T extends {}> = TransformType<{
    [K in keyof T]: T[K] extends { type: infer U } ? U : T[K];
}>;

// tweak stimulus value definition map to support typed array and object
type ValueDefinitionMap = {
    [token: string]: ValueTypeDefinition;
};

type ValueTypeConstant =
    | typeof Array<any>
    | typeof Boolean
    | typeof Number
    | typeof Object
    | typeof String
    | typeof Object_;

type ValueTypeDefault = Array<any> | boolean | number | Object | typeof Object_ | string;

type ValueTypeObject = Partial<{
    type: ValueTypeConstant;
    default: ValueTypeDefault;
}>;

type ValueTypeDefinition = ValueTypeConstant | ValueTypeObject;

type TargetDefinitionMap = {
    [token: string]: typeof Element | typeof Target;
};

type OutletDefinitionMap = {
    [token: string]: Constructor<Controller>;
};

type Statics<
    Values extends ValueDefinitionMap,
    Targets extends TargetDefinitionMap,
    Outlets extends OutletDefinitionMap,
    Classes extends readonly string[],
    Portals extends boolean,
> = {
    values?: Values;
    targets?: Targets;
    outlets?: Outlets;
    classes?: Classes;
    portals?: Portals;
};

type ClassProperties<C extends readonly string[]> = Simplify<
    {
        [K in C[number] as `${CamelCase<K>}Class`]: string;
    } & {
    [K in C[number] as `has${Capitalize<CamelCase<K>>}Class`]: boolean;
} & {
    [K in C[number] as `${CamelCase<K>}Classes`]: string[];
}
>;

type PortalProperties = {
    portalOutlet: Portal;
    hasPortalOutlet: boolean;
    portalOutlets: Portal[];
    portalOutletConnected: (outlet: Portal, element: HTMLElement) => void;
    portalOutletDisconnected: (outlet: Portal, element: HTMLElement) => void;
    portalSelectorsValue: string[];
    hasPortalSelectorsValue: boolean;
    portalSelectorsValueChanged: (value: string[], previousValue: string[]) => void;
}

export function PortalsAwareController<Base extends Constructor<Controller>>(Base: Base) {
    return class extends Base
    {
        constructor(...args: any[]) {
            super(...args);

            const portalOutlets: Set<Portal> = new Set();

            const originalDisconnect = this.disconnect;
            this.disconnect = function (): void {
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
    };
}

type StimulusProperties<
    Values extends ValueDefinitionMap,
    Targets extends TargetDefinitionMap,
    Outlets extends OutletDefinitionMap,
    Classes extends readonly string[],
    Portals extends boolean,
> = Simplify<
    MagicProperties<TransformValueDefinition<Values>, "Value"> &
    MagicProperties<TransformType<Targets>, "Target"> &
    MagicProperties<TransformType<Outlets>, "Outlet"> &
    ClassProperties<Classes> &
    (Portals extends true ? PortalProperties : {})
>;

/**
 * Convert typed Object_ to ObjectConstructor before passing values to Stimulus
 */
function patchValueTypeDefinitionMap(values: ValueDefinitionMap) {
    const patchObject = (def: ValueTypeDefinition) => {
        if ("type" in def) {
            return {
                type: def.type === Object_ ? Object : def.type,
                default: def.default,
            };
        } else {
            return def === Object_ ? Object : def;
        }
    };
    return Object.entries(values).reduce((result, [key, def]) => {
        result[key] = patchObject(def);
        return result;
    }, {} as ValueDefinitionMap);
}

type PreservedStaticMethods<T> = { [K in keyof T]: T[K] };

export function Typed<
    Values extends ValueDefinitionMap = {},
    Targets extends TargetDefinitionMap = {},
    Outlets extends OutletDefinitionMap = {},
    Classes extends readonly string[] = [],
    Portals extends boolean = false,
    Base extends Constructor<Controller> = Constructor<Controller>,
>(Base: Base, statics: Statics<Values, Targets, Outlets, Classes, Portals> = {}) {
    const {values, targets, classes, outlets, portals} = statics;

    const patchedOutlets = Object.getOwnPropertyNames(outlets ?? {});

    const patchedValues: ValueDefinitionMap = values ?? {};

    if (portals === true) {
        patchedOutlets.push('portal');
        if (typeof patchedValues['portalSelectors'] === 'undefined') {
            patchedValues['portalSelectors'] = {
                type: Array<string>,
                default: [],
            };
        }
    }

    let derived = class extends Base
    {
        static values = patchValueTypeDefinitionMap(patchedValues);
        static targets = Object.getOwnPropertyNames(targets ?? {});
        static outlets = patchedOutlets;
        static classes = classes ?? [];
    };

    if (portals === true) {
        derived = PortalsAwareController(derived);
    }

    return derived as unknown as PreservedStaticMethods<typeof Base> & {
        new(context: Context): InstanceType<Base> & StimulusProperties<Values, Targets, Outlets, Classes, Portals>;
    };
}
