import {Controller} from "@hotwired/stimulus";

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

type ValueTypeDefault = string | number | boolean | Array<any> | Object | InstanceType<typeof Wrapped>;

type ValueTypeConstant =
    | typeof String
    | typeof Number
    | typeof Boolean
    | typeof Array<any>
    | typeof Object
    | InstanceType<typeof Wrapped>

type ValueTypeObject = {
    type: ValueTypeConstant;
    default?: ValueTypeDefault;
};

type ValueTypeDefinition = ValueTypeConstant | ValueTypeObject | InstanceType<typeof Wrapped>;

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

type TargetTypeDefinition = typeof Element | InstanceType<typeof Wrapped>;

type TargetsDefinitionMap = {
    [token: string]: TargetTypeDefinition;
};

type TransformTargetDefinition<T extends TargetTypeDefinition> =
    T extends Wrapped<infer U>
        ? U
        : T extends new (...args: any[]) => infer R
            ? R
            : never;

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

type Configuration<
    Values extends ValueDefinitionMap,
    Targets extends TargetsDefinitionMap,
    Classes extends readonly string[],
    Outlets extends OutletsDefinitionMap,
> = {
    values?: Values;
    targets?: Targets;
    classes?: Classes;
    outlets?: Outlets;
};

function patchValueTypeDefinitionMap(values: ValueDefinitionMap): ValueDefinitionMap {
    const patchedValues: ValueDefinitionMap = {};
    const patchType = (type: any) => {
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
                type: patchType(definition.type),
                default: definition.default,
            };
        } else if (typeof definition === 'object' && 'type' in definition) {
            patchedValues[key] = patchType(definition.type);
        } else if (definition instanceof Wrapped) {
            patchedValues[key] = patchType(definition);
        } else {
            patchedValues[key] = definition;
        }
    });
    return patchedValues;
}

export function Typed<
    Base extends Constructor<Controller>,
    Values extends ValueDefinitionMap = {},
    Targets extends TargetsDefinitionMap = {},
    Classes extends readonly string[] = [],
    Outlets extends OutletsDefinitionMap = {},
>(Base: Base, configuration?: Configuration<Values, Targets, Classes, Outlets>) {
    const {values, targets, classes, outlets} = configuration ?? {};

    const derived = class extends Base
    {
        constructor(...args: any[]) {
            super(...args);
        }

        static values = patchValueTypeDefinitionMap(values ?? {});
        static targets = Object.getOwnPropertyNames(targets ?? {});
        static classes = classes ?? [];
        static outlets = Object.getOwnPropertyNames(outlets ?? {});
    };

    return derived as unknown as typeof Base & {
        new(...args: any[]): InstanceType<Base>
            & ValuesProperties<Values>
            & TargetsProperties<Targets>
            & ClassProperties<Classes>
            & OutletProperties<Outlets>;
    }
}
