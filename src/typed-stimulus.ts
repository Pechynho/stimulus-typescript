import {Context, Controller} from "@hotwired/stimulus";
import PortalController from "./portal-controller";

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
    Portals extends readonly string[],
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

type PortalOutletProperties = {
    portalOutlet: PortalController;
    hasPortalOutlet: boolean;
    portalOutlets: PortalController[];
    portalOutletConnected: (outlet: PortalController, element: HTMLElement) => void;
    portalOutletDisconnected: (outlet: PortalController, element: HTMLElement) => void;
}

function withPortals<BaseClass extends Constructor<Controller>>(Base: BaseClass, portals: readonly string[]) {
    return class extends Base
    {
        constructor(...args: any[]) {
            super(...args);

            const portalOutlets: Set<PortalController> = new Set();

            const originalConnect = this.connect;
            this.connect = function (): void {
                this.element.setAttribute(`data-${this.identifier}-portal-outlet`, portals.join(', '));
                if (typeof originalConnect === "function") {
                    originalConnect.call(this);
                }
            };

            const originalDisconnect = this.disconnect;
            this.disconnect = function (): void {
                this.element.removeAttribute(`data-${this.identifier}-portal-outlet`);
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
            (this as any).portalOutletConnected = function (outlet: PortalController, element: HTMLElement): void {
                outlet.sync(this);
                portalOutlets.add(outlet);
                if (typeof originalPortalOutletConnected === 'function') {
                    originalPortalOutletConnected.call(this, outlet, element);
                }
            };

            const originalPortalOutletDisconnected = (this as any).portalOutletDisconnected;
            (this as any).portalOutletDisconnected = function (outlet: PortalController, element: HTMLElement): void {
                outlet.unsync(this);
                portalOutlets.delete(outlet);
                if (typeof originalPortalOutletDisconnected === 'function') {
                    originalPortalOutletDisconnected.call(this, outlet, element);
                }
            };
        }
    };
}

type StimulusProperties<
    Values extends ValueDefinitionMap,
    Targets extends TargetDefinitionMap,
    Outlets extends OutletDefinitionMap,
    Classes extends readonly string[],
    Portals extends readonly string[],
> = Simplify<
    MagicProperties<TransformValueDefinition<Values>, "Value"> &
    MagicProperties<TransformType<Targets>, "Target"> &
    MagicProperties<TransformType<Outlets>, "Outlet"> &
    ClassProperties<Classes> &
    (Portals['length'] extends 0 ? {} : PortalOutletProperties)
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

/**
 * Strongly typed Controller!
 * ```ts
 * const values = {
 *  name: String,
 *  alias: Array<string>,
 *  address: Object_<{ street: string }>
 * }
 * const targets = { form: HTMLFormElement, "select": Target<CustomSelect> }
 * const classes = ['selected', 'highlighted'] as const;
 * const outlets = { "user-status": UserStatusController }
 * const portals = ['#portal'] as const;
 *
 * class MyController extends Typed(Controller, { values, targets, classes, outlets, portals }) {
 *  // Look Ma, no "declare ..."
 *  this.nameValue.split(' ')
 *  this.aliasValue.map(alias => alias.toUpperCase())
 *  this.addressValue.street
 *  this.formTarget.submit()
 *  this.selectTarget.search = "stimulus";
 *  this.userStatusOutlets.forEach(status => status.markAsSelected(event))
 *  this.hasSelectedClass
 *  this.selectedClass
 * }
 * ```
 */

type PreservedStaticMethods<T> = { [K in keyof T]: T[K] };

export function Typed<
    Values extends ValueDefinitionMap = {},
    Targets extends TargetDefinitionMap = {},
    Outlets extends OutletDefinitionMap = {},
    Classes extends readonly string[] = [],
    Portals extends readonly string[] = [],
    Base extends Constructor<Controller> = Constructor<Controller>,
>(Base: Base, statics: Statics<Values, Targets, Outlets, Classes, Portals> = {}) {
    const {values, targets, classes, outlets, portals} = statics;

    const patchedOutlets = Object.getOwnPropertyNames(outlets ?? {});

    if (Array.isArray(portals) && portals.length > 0) {
        patchedOutlets.push('portal');
    }

    let derived = class extends Base
    {
        static values = patchValueTypeDefinitionMap(values ?? {});
        static targets = Object.getOwnPropertyNames(targets ?? {});
        static outlets = patchedOutlets;
        static classes = classes ?? [];
    };

    if (Array.isArray(portals) && portals.length > 0) {
        derived = withPortals(derived, portals);
    }

    return derived as unknown as PreservedStaticMethods<typeof Base> & {
        new(context: Context): InstanceType<Base> & StimulusProperties<Values, Targets, Outlets, Classes, Portals>;
    };
}
