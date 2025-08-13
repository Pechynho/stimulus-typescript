import {ActionEvent, Controller} from "@hotwired/stimulus";
import {throttle} from "throttle-debounce";
import {camelCase, capitalize} from "./utils";

const proxyActionPrefix = '__proxyAction__';

export class Action {
    constructor(
        public readonly event: string | undefined,
        public readonly identifier: string,
        public readonly method: string,
        public readonly modifier: string | undefined
    ) {
    }

    toString(): string {
        let directive = '';
        if (this.event !== undefined) {
            directive += `${this.event}->`;
        }
        directive += `${this.identifier}#${this.method}`;
        if (this.modifier !== undefined) {
            directive += `:${this.modifier}`;
        }
        return directive;
    }
}

export default class PortalController extends Controller<HTMLElement> {
    private observer: MutationObserver | null = null;
    private isConnected: boolean = false;
    private isSetupProxyActionsRunning: boolean = false;
    private identifiers: Set<string> = new Set();
    private searchedIdentifiersForTargets: Set<string> = new Set();
    private searchedIdentifiersForActions: Set<string> = new Set();
    private controllers: Map<string, Set<Controller>> = new Map();
    private targetsByController: Map<Controller, Set<Element>> = new Map();
    private targetsByIdentifier: Map<string, Set<Element>> = new Map();
    private targetsByTargetName: Map<string, Map<string, Set<Element>>> = new Map();
    private controllerOriginalMethods: Map<Controller, { [key: string]: TypedPropertyDescriptor<Controller> }> = new Map();
    private actionElements: Set<Element> = new Set();
    private proxyAttachedMethodNames: Set<string> = new Set();

    public initialize(): void {
        this.searchTargets = throttle(1, this.searchTargets.bind(this));
        this.searchActions = throttle(1, this.searchActions.bind(this));
        this.setupProxyActions = throttle(1, this.setupProxyActions.bind(this));
    }

    public connect(): void {
        this.isConnected = true;
        this.reinitializeObserver();
        this.connectObserver();
        this.searchTargets();
        this.searchActions();
    }

    public disconnect(): void {
        this.isConnected = false;
        this.isSetupProxyActionsRunning = false;
        this.disconnectAllTargets();
        this.restoreControllersGetTargetMethods();
        this.removeProxyActions();
        this.disconnectObserver();
        this.identifiers.clear();
        this.searchedIdentifiersForTargets.clear();
        this.searchedIdentifiersForActions.clear();
        this.controllers.clear();
        this.targetsByController.clear();
        this.targetsByIdentifier.clear();
        this.targetsByTargetName.clear();
        this.controllerOriginalMethods.clear();
        this.actionElements.clear();
    }

    public sync(controller: Controller): void {
        this.identifiers.add(controller.identifier);
        let controllers = this.controllers.get(controller.identifier);
        if (controllers === undefined) {
            controllers = new Set<Controller>();
            this.controllers.set(controller.identifier, controllers);
        }
        controllers.add(controller);
        this.overrideControllerGetTargetMethods(controller);
        if (this.isConnected) {
            this.reinitializeObserver();
            this.connectObserver();
            this.searchTargets();
            this.searchActions();
        }
        const targetsByIdentifier = this.targetsByIdentifier.get(controller.identifier);
        if (targetsByIdentifier !== undefined) {
            for (const target of targetsByIdentifier) {
                this.addTarget(target, controller.identifier);
            }
        }
    }

    public unsync(controller: Controller): void {
        const controllers = this.controllers.get(controller.identifier);
        if (controllers === undefined) {
            return;
        }
        controllers.delete(controller);
        this.restoreControllerGetTargetMethods(controller);
        if (controllers.size === 0) {
            this.controllers.delete(controller.identifier);
            this.identifiers.delete(controller.identifier);
            this.targetsByIdentifier.delete(controller.identifier);
            this.searchedIdentifiersForTargets.delete(controller.identifier);
            this.searchedIdentifiersForActions.delete(controller.identifier);
            this.targetsByTargetName.delete(controller.identifier);
            if (this.isConnected) {
                this.setupProxyActions();
            }
        }
        this.targetsByController.delete(controller);
        this.reinitializeObserver();
        this.connectObserver();
    }

    private reinitializeObserver() {
        this.disconnectObserver();
        this.observer = new MutationObserver(this.handleMutations.bind(this));
    }

    private connectObserver(): void {
        if (this.observer === null) {
            return;
        }
        const attributes = [this.getActionAttributeName()];
        for (const identifier of this.identifiers) {
            attributes.push(this.getTargetAttributeName(identifier));
        }
        this.observer.observe(this.element, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: attributes,
            attributeOldValue: true,
        });
    }

    private disconnectObserver(): void {
        if (this.observer === null) {
            return;
        }
        this.observer.disconnect();
    }

    private handleMutations(mutations: MutationRecord[]) {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        if (this.isObservedTargetElement(node)) {
                            this.addTarget(node);
                        }
                        if (node.hasAttribute(this.getActionAttributeName())) {
                            this.addActionElement(node);
                        }
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node instanceof Element) {
                        if (this.isObservedTargetElement(node)) {
                            this.removeTarget(node);
                        }
                        if (node.hasAttribute(this.getActionAttributeName())) {
                            this.removeActionElement(node);
                        }
                    }
                }
            } else if (mutation.type === 'attributes' && mutation.target instanceof Element && typeof mutation.attributeName === 'string') {
                const oldValue = mutation.oldValue;
                const currentValue = mutation.target.getAttribute(mutation.attributeName);
                if (mutation.attributeName === this.getActionAttributeName()) {
                    if (oldValue === null && currentValue !== null) {
                        this.addActionElement(mutation.target);
                    } else if (oldValue !== null && currentValue !== null && oldValue !== currentValue) {
                        this.addActionElement(mutation.target);
                    } else if (oldValue !== null && currentValue === null) {
                        this.removeActionElement(mutation.target);
                    }
                } else {
                    for (const identifier of this.identifiers) {
                        if (mutation.attributeName === this.getTargetAttributeName(identifier)) {
                            if (oldValue === null && currentValue !== null) {
                                this.addTarget(mutation.target, identifier);
                            } else if (oldValue !== null && currentValue === null) {
                                this.removeTarget(mutation.target, identifier);
                            } else if (oldValue !== null && currentValue !== null && oldValue !== currentValue) {
                                this.removeStoredTargetByTargetName(mutation.target, identifier, oldValue);
                                this.storeTargetByTargetName(mutation.target, identifier, currentValue);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    private addTarget(target: Element): void;
    private addTarget(target: Element, identifier: string): void;
    private addTarget(firstArg: any, secondArg?: any): void {
        const target = firstArg;
        if (!(target instanceof Element)) {
            throw new Error('Expected first argument to be an Element');
        }
        const identifier = secondArg;
        const addTarget = (target: Element, identifier: string): void => {
            const targetAttributeName = this.getTargetAttributeName(identifier);
            if (!target.hasAttribute(targetAttributeName)) {
                return;
            }
            let targetsByIdentifier = this.targetsByIdentifier.get(identifier);
            if (targetsByIdentifier === undefined) {
                targetsByIdentifier = new Set();
                this.targetsByIdentifier.set(identifier, targetsByIdentifier);
            }
            targetsByIdentifier.add(target);
            const targetName = target.getAttribute(targetAttributeName)!;
            this.storeTargetByTargetName(target, identifier, targetName);
            const controllers = this.controllers.get(identifier);
            if (controllers === undefined) {
                return;
            }
            for (const controller of controllers) {
                let targetsByController = this.targetsByController.get(controller);
                if (targetsByController === undefined) {
                    targetsByController = new Set();
                    this.targetsByController.set(controller, targetsByController);
                }
                if (targetsByController.has(target)) {
                    continue;
                }
                try {
                    controller.context.invokeControllerMethod(this.getTargetConnectedMethodName(targetName), target);
                } catch (e) {
                    console.error(e);
                } finally {
                    targetsByController.add(target);
                }
            }
        }
        if (typeof identifier === 'string') {
            addTarget(target, identifier);
        } else if (typeof identifier === 'undefined') {
            for (const identifier of this.identifiers) {
                addTarget(target, identifier);
            }
        } else {
            throw new Error('Expected second argument to be a string or undefined');
        }
    }

    private removeTarget(target: Element): void;
    private removeTarget(target: Element, identifier: string): void;
    private removeTarget(firstArg: any, secondArg?: any): void {
        const target = firstArg;
        if (!(target instanceof Element)) {
            throw new Error('Expected first argument to be an Element');
        }
        const identifier = secondArg;
        const removeTarget = (target: Element, identifier: string): void => {
            const targetAttributeName = this.getTargetAttributeName(identifier);
            if (!target.hasAttribute(targetAttributeName)) {
                return;
            }
            const targetsByIdentifier = this.targetsByIdentifier.get(identifier);
            if (targetsByIdentifier !== undefined) {
                targetsByIdentifier.delete(target);
            }
            const targetName = target.getAttribute(targetAttributeName)!;
            this.removeStoredTargetByTargetName(target, identifier, targetName);
            const controllers = this.controllers.get(identifier);
            if (controllers === undefined) {
                return;
            }
            for (const controller of controllers) {
                let targetsByController = this.targetsByController.get(controller);
                if (targetsByController === undefined) {
                    targetsByController = new Set();
                    this.targetsByController.set(controller, targetsByController);
                }
                if (!targetsByController.has(target)) {
                    continue;
                }
                try {
                    controller.context.invokeControllerMethod(this.getTargetDisconnectedMethodName(targetName), target);
                } catch (e) {
                    console.error(e);
                } finally {
                    targetsByController.delete(target);
                }
            }
        }
        if (typeof identifier === 'string') {
            removeTarget(target, identifier);
        } else if (typeof identifier === 'undefined') {
            for (const identifier of this.identifiers) {
                removeTarget(target, identifier);
            }
        } else {
            throw new Error('Expected second argument to be a string or undefined');
        }
    }

    private disconnectAllTargets(): void {
        for (const identifier of this.identifiers) {
            const targetsByIdentifier = this.targetsByIdentifier.get(identifier);
            if (targetsByIdentifier !== undefined) {
                targetsByIdentifier.clear();
            }
            const controllers = this.controllers.get(identifier);
            if (controllers === undefined) {
                continue;
            }
            for (const controller of controllers) {
                const targetsByController = this.targetsByController.get(controller);
                if (targetsByController === undefined) {
                    continue;
                }
                for (const target of targetsByController) {
                    const targetAttributeName = this.getTargetAttributeName(identifier);
                    if (!target.hasAttribute(targetAttributeName)) {
                        continue;
                    }
                    const targetName = target.getAttribute(targetAttributeName)!;
                    this.removeStoredTargetByTargetName(target, identifier, targetName);
                    try {
                        controller.context.invokeControllerMethod(this.getTargetDisconnectedMethodName(targetName), target);
                    } catch (e) {
                        console.error(e);
                    }
                }
                targetsByController.clear();
            }
        }
    }

    private searchTargets(): void {
        if (!this.isConnected) {
            return;
        }
        let batch = [];
        const batchSize = 5;
        const identifiers = [...this.identifiers].filter(identifier => !this.searchedIdentifiersForTargets.has(identifier));
        for (let i = 0; i < identifiers.length; i++) {
            batch.push(`[${this.getTargetAttributeName(identifiers[i])}]`);
            if (batch.length == batchSize || i + 1 === identifiers.length) {
                const targets = this.element.querySelectorAll(batch.join(','));
                for (const target of targets) {
                    if (target instanceof Element) {
                        this.addTarget(target, identifiers[i]);
                    }
                }
                batch = [];
            }
            this.searchedIdentifiersForTargets.add(identifiers[i]);
        }
    }

    private searchActions(): void {
        if (!this.isConnected) {
            return;
        }
        const identifiers = [...this.identifiers].filter(identifier => !this.searchedIdentifiersForActions.has(identifier));
        if (identifiers.length === 0) {
            return;
        }
        const elements = this.element.querySelectorAll(`[${this.getActionAttributeName()}]`);
        for (const element of elements) {
            this.addActionElement(element);
        }
        for (const identifier of identifiers) {
            this.searchedIdentifiersForActions.add(identifier);
        }
    }

    private getTargetConnectedMethodName(targetName: string): string {
        return camelCase(targetName) + 'TargetConnected';
    }

    private getTargetDisconnectedMethodName(targetName: string): string {
        return camelCase(targetName) + 'TargetDisconnected';
    }

    private getTargetAttributeName(identifier: string): string {
        return `data-${identifier}-target`;
    }

    private getActionAttributeName(): string {
        return this.context.schema.actionAttribute;
    }

    private isObservedTargetElement(element: Element): boolean {
        for (const identifier of this.identifiers) {
            if (element.hasAttribute(this.getTargetAttributeName(identifier))) {
                return true;
            }
        }
        return false;
    }

    private overrideControllerGetTargetMethods(controller: Controller): void {
        let originalMethods = this.controllerOriginalMethods.get(controller);
        if (originalMethods !== undefined) {
            throw new Error(`Controller ${controller.identifier} already has overridden target methods`);
        }
        originalMethods = {};
        const targetNames = (controller.constructor as any).targets;
        if (!Array.isArray(targetNames) || targetNames.length === 0) {
            return;
        }
        const targetDescriptorsMap: Map<string, string> = new Map();
        for (const targetName of targetNames) {
            targetDescriptorsMap.set(`${targetName}Target`, targetName);
            targetDescriptorsMap.set(`${targetName}Targets`, targetName);
            targetDescriptorsMap.set(`has${capitalize(targetName)}Target`, targetName);
        }
        const descriptors: { [key: string]: TypedPropertyDescriptor<Controller> } = {};
        let prototype = controller;
        while (prototype !== Object.prototype) {
            const prototypeDescriptors = Object.getOwnPropertyDescriptors(prototype);
            Object.keys(prototypeDescriptors).forEach((descriptorName) => {
                if (!targetDescriptorsMap.has(descriptorName) || descriptors[descriptorName] !== undefined) {
                    return;
                }
                descriptors[descriptorName] = prototypeDescriptors[descriptorName] as TypedPropertyDescriptor<Controller>;
            });
            prototype = Object.getPrototypeOf(prototype);
        }
        Object.keys(descriptors).forEach((descriptorName) => {
            const targetName = targetDescriptorsMap.get(descriptorName);
            if (targetName === undefined) {
                return;
            }
            const portal = this;
            const descriptor = descriptors[descriptorName];
            if (descriptorName === `has${capitalize(targetName)}Target`) {
                originalMethods[descriptorName] = descriptor;
                Object.defineProperty(controller, descriptorName, {
                    get: function (): boolean {
                        if (portal.hasStoredTargetsByTargetName(controller.identifier, targetName)) {
                            return true;
                        }
                        return controller.targets.has(targetName);
                    },
                    configurable: true,
                    enumerable: descriptor.enumerable,
                });
            } else if (descriptorName === `${targetName}Target`) {
                originalMethods[descriptorName] = descriptor;
                Object.defineProperty(controller, descriptorName, {
                    get: function (): Element {
                        if (portal.hasStoredTargetsByTargetName(controller.identifier, targetName)) {
                            return portal.getStoredTargetsByTargetName(controller.identifier, targetName)[0];
                        }
                        const target = controller.targets.find(targetName);
                        if (target === undefined) {
                            throw new Error(`Missing target element "${targetName}" for "${controller.identifier}" controller`);
                        }
                        return target;
                    },
                    configurable: true,
                    enumerable: descriptor.enumerable,
                });
            } else if (descriptorName === `${targetName}Targets`) {
                originalMethods[descriptorName] = descriptor;
                Object.defineProperty(controller, descriptorName, {
                    get: function (): Element[] {
                        return [
                            ...portal.getStoredTargetsByTargetName(controller.identifier, targetName),
                            ...controller.targets.findAll(targetName),
                        ];
                    },
                    configurable: true,
                    enumerable: descriptor.enumerable,
                });
            }
        });
        this.controllerOriginalMethods.set(controller, originalMethods);
    }

    private restoreControllerGetTargetMethods(controller: Controller): void {
        const originalMethods = this.controllerOriginalMethods.get(controller);
        if (originalMethods === undefined) {
            return;
        }
        for (const [descriptorName, descriptor] of Object.entries(originalMethods)) {
            Object.defineProperty(controller, descriptorName, {
                ...descriptor,
                configurable: true,
                enumerable: descriptor.enumerable,
            });
        }
        this.controllerOriginalMethods.delete(controller);
    }

    private restoreControllersGetTargetMethods(): void {
        const controllers = this.controllerOriginalMethods.keys();
        for (const controller of controllers) {
            this.restoreControllerGetTargetMethods(controller);
        }
    }

    private storeTargetByTargetName(target: Element, identifier: string, targetName: string): void {
        let targetsByTargetName1 = this.targetsByTargetName.get(identifier);
        if (targetsByTargetName1 === undefined) {
            targetsByTargetName1 = new Map();
            this.targetsByTargetName.set(identifier, targetsByTargetName1);
        }
        let targetsByTargetName2 = targetsByTargetName1.get(targetName);
        if (targetsByTargetName2 === undefined) {
            targetsByTargetName2 = new Set();
            targetsByTargetName1.set(targetName, targetsByTargetName2);
        }
        targetsByTargetName2.add(target);
    }

    private removeStoredTargetByTargetName(target: Element, identifier: string, targetName: string): void {
        const targetsByTargetName1 = this.targetsByTargetName.get(identifier);
        if (targetsByTargetName1 === undefined) {
            return;
        }
        const targetsByTargetName2 = targetsByTargetName1.get(targetName);
        if (targetsByTargetName2 === undefined) {
            return;
        }
        targetsByTargetName2.delete(target);
    }

    private hasStoredTargetsByTargetName(identifier: string, targetName: string): boolean {
        const targetsByTargetName1 = this.targetsByTargetName.get(identifier);
        if (targetsByTargetName1 === undefined) {
            return false;
        }
        const targetsByTargetName2 = targetsByTargetName1.get(targetName);
        if (targetsByTargetName2 === undefined) {
            return false;
        }
        return targetsByTargetName2.size > 0;
    }

    private getStoredTargetsByTargetName(identifier: string, targetName: string): Element[] {
        const targetsByTargetName1 = this.targetsByTargetName.get(identifier);
        if (targetsByTargetName1 === undefined) {
            return [];
        }
        const targetsByTargetName2 = targetsByTargetName1.get(targetName);
        if (targetsByTargetName2 === undefined) {
            return [];
        }
        return [...targetsByTargetName2.values()];
    }

    private addActionElement(element: Element): void {
        if (!element.hasAttribute(this.getActionAttributeName())) {
            return;
        }
        this.actionElements.add(element);
        this.setupProxyActions();
    }

    private removeActionElement(element: Element): void {
        if (element.hasAttribute(this.getActionAttributeName())) {
            return;
        }
        this.actionElements.delete(element);
        this.setupProxyActions();
    }

    private setupProxyActions(): void {
        if (!this.isConnected) {
            return;
        }
        if (this.isSetupProxyActionsRunning) {
            this.setupProxyActions();
            return;
        }
        this.isSetupProxyActionsRunning = true;
        try {
            const proxyMethodNames: Set<string> = new Set();
            const actionAttributeName = this.getActionAttributeName();
            for (const actionElement of this.actionElements) {
                if (!actionElement.hasAttribute(actionAttributeName)) {
                    continue;
                }
                const actionAttributeValue = actionElement.getAttribute(actionAttributeName)!;
                const actions = this.parseActions(actionElement);
                const actionsToProxy = [];
                const newAttributeValueTokens = [];
                for (const action of actions) {
                    newAttributeValueTokens.push(action.toString());
                    if (this.identifiers.has(action.identifier)) {
                        actionsToProxy.push(action);
                    }
                }
                for (const action of actionsToProxy) {
                    const proxyAction = new Action(action.event, this.identifier, this.getProxyActionName(action.method), action.modifier);
                    proxyMethodNames.add(proxyAction.method);
                    newAttributeValueTokens.push(proxyAction.toString());
                }
                const newAttributeValue = newAttributeValueTokens.join(' ');
                if (newAttributeValue !== actionAttributeValue) {
                    newAttributeValue === ''
                        ? actionElement.removeAttribute(actionAttributeName)
                        : actionElement.setAttribute(actionAttributeName, newAttributeValue);
                }
            }
            for (const propertyName of this.proxyAttachedMethodNames) {
                if (typeof (this as any)[propertyName] === 'function' && this.isProxyActionName(propertyName) && !proxyMethodNames.has(propertyName)) {
                    delete (this as any)[propertyName];
                    this.proxyAttachedMethodNames.delete(propertyName);
                }
            }
            for (const proxyMethodName of proxyMethodNames) {
                if (this.proxyAttachedMethodNames.has(proxyMethodName)) {
                    continue;
                }
                const methodName = this.extractActionFromProxyActionName(proxyMethodName);
                (this as any)[proxyMethodName] = (event: ActionEvent): void => {
                    const target = event.currentTarget;
                    if (!(target instanceof Element)) {
                        console.warn(`Proxy action "${proxyMethodName}" called on non-element target`, event);
                        return;
                    }
                    const actions = this.parseActions(target);
                    for (const action of actions) {
                        if (action.identifier === this.identifier || action.method !== methodName) {
                            continue;
                        }
                        const controllers = this.controllers.get(action.identifier);
                        if (controllers === undefined) {
                            continue;
                        }
                        event.params = this.getActionParams(target, action.identifier);
                        for (const controller of controllers) {
                            try {
                                controller.context.invokeControllerMethod(action.method, event);
                            } catch (e) {
                                console.error(e);
                            }
                        }
                    }
                }
                this.proxyAttachedMethodNames.add(proxyMethodName);
            }
        } finally {
            this.isSetupProxyActionsRunning = false;
        }
    }

    private removeProxyActions(): void {
        for (const propertyName of this.proxyAttachedMethodNames) {
            if (typeof (this as any)[propertyName] === 'function' && this.isProxyActionName(propertyName)) {
                delete (this as any)[propertyName];
            }
        }
        this.proxyAttachedMethodNames.clear();
    }

    private parseActions(element: Element): Action[] {
        const actionAttributeName = this.getActionAttributeName();
        if (!element.hasAttribute(actionAttributeName)) {
            return [];
        }
        const actions: Action[] = [];
        const attributeValue = element.getAttribute(actionAttributeName)!;
        const tokens = attributeValue.split(' ');
        for (const token of tokens) {
            if (token.trim() === '') {
                continue;
            }
            let [event, rest]: (string | undefined)[] = token.split('->');
            if (rest === undefined) {
                rest = event;
                event = undefined;
            }
            const [identifier, methodDetails] = rest.split('#');
            const [method, modifier] = methodDetails.split(':');
            if (identifier === this.identifier) {
                continue;
            }
            const action = new Action(event, identifier, method, modifier);
            actions.push(action);
        }
        return actions;
    }

    private getProxyActionName(action: string): string {
        return `${proxyActionPrefix}${action}`;
    }

    private isProxyActionName(action: string): boolean {
        return action.startsWith(proxyActionPrefix);
    }

    private extractActionFromProxyActionName(action: string): string {
        return action.substring(proxyActionPrefix.length);
    }

    private getActionParams(element: Element, identifier: string): { [_key: string]: any } {
        const params: { [_key: string]: any } = {}
        const parseParam = (value: string): any => {
            try {
                return JSON.parse(value)
            } catch (_) {
                return value
            }
        };
        const pattern = new RegExp(`^data-${identifier}-(.+)-param$`, 'i')
        for (const {name, value} of Array.from(element.attributes)) {
            const match = name.match(pattern)
            if (match === null) {
                continue
            }
            params[camelCase(match[1])] = parseParam(value);
        }
        return params
    }
}
