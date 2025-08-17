import {Controller} from "@hotwired/stimulus";
import Portal from "./portal-controller";

type Constructor<T = {}> = new (...args: any[]) => T;

export function Portals<Base extends Constructor<Controller>>(Base: Base) {
    let outlets = (Base as any).outlets;
    if (typeof outlets === 'undefined') {
        outlets = [];
    } else if (!Array.isArray(outlets)) {
        throw new Error('Outlets must be an array');
    }
    if (!outlets.includes('portal')) {
        outlets.push('portal');
    }
    let values = (Base as any).values;
    if (typeof values === 'undefined') {
        values = {};
    } else if (typeof values !== 'object') {
        throw new Error('Values must be an object');
    }
    if (typeof values['portalSelectors'] === 'undefined') {
        values['portalSelectors'] = {
            type: Array,
            default: [],
        };
    }
    const derived = class extends Base
    {
        static outlets = outlets;
        static values = values;

        constructor(...args: any[]) {
            super(...args);

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
    }
    return derived as unknown as typeof Base & {
        new(...args: any[]): InstanceType<Base> & {
            readonly portalOutlet: Portal;
            readonly hasPortalOutlet: boolean;
            readonly portalOutlets: Portal[];
            portalSelectorsValue: string[];
            readonly hasPortalSelectorsValue: boolean;
        }
    }
}
