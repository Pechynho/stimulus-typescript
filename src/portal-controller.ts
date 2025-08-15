import {ActionEvent, Controller} from "@hotwired/stimulus";
import {throttle} from "throttle-debounce";
import {camelCase, capitalize} from "./utils";

const proxyActionPrefix = '__proxyAction__';

class Action
{
    constructor(
        public readonly event: string | undefined,
        public readonly identifier: string,
        public readonly method: string,
        public readonly modifier: string | undefined,
        public stringified: string | null = null,
    ) {
    }

    toString(): string {
        if (this.stringified !== null) {
            return this.stringified;
        }
        let directive = '';
        if (this.event !== undefined) {
            directive += `${this.event}->`;
        }
        directive += `${this.identifier}#${this.method}`;
        if (this.modifier !== undefined) {
            directive += `:${this.modifier}`;
        }
        this.stringified = directive;
        return this.stringified;
    }
}

export default class extends Controller<HTMLElement>
{
    private observer: MutationObserver | null = null;
    private isConnected: boolean = false;
    private identifiers: Set<string> = new Set();
    private searchedIdentifiersForTargets: Set<string> = new Set();
    private searchedIdentifiersForActions: Set<string> = new Set();
    private controllers: Map<string, Set<Controller>> = new Map();
    private targetsByController: Map<Controller, Set<Element>> = new Map();
    private targetsByIdentifier: Map<string, Set<Element>> = new Map();
    private targetsByTargetName: Map<string, Map<string, Set<Element>>> = new Map();
    private controllerOriginalMethods: Map<Controller, { [key: string]: TypedPropertyDescriptor<Controller> }> = new Map();
    private actionToElementsMap: Map<string, Set<Element>> = new Map();
    private elementToActionsMap: Map<Element, Set<string>> = new Map();
    private identifierToActionElementsMap: Map<string, Set<Element>> = new Map();
    private actionElementToIdentifiersMap: Map<Element, Set<string>> = new Map();

    public initialize(): void {
        this.searchTargets = throttle(1, this.searchTargets.bind(this));
        this.searchActions = throttle(1, this.searchActions.bind(this));
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
        this.disconnectAllTargets();
        this.restoreControllersGetTargetMethods();
        this.removeAllProxyActions();
        this.disconnectObserver();
        this.identifiers.clear();
        this.searchedIdentifiersForTargets.clear();
        this.searchedIdentifiersForActions.clear();
        this.controllers.clear();
        this.targetsByController.clear();
        this.targetsByIdentifier.clear();
        this.targetsByTargetName.clear();
        this.controllerOriginalMethods.clear();
        this.actionToElementsMap.clear();
        this.elementToActionsMap.clear();
        this.identifierToActionElementsMap.clear();
        this.actionElementToIdentifiersMap.clear();
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
                this.removeAllProxyActionsByIdentifier(controller.identifier);
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
                        this.removeActionElement(mutation.target, true);
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

    private getPortalledActionAttributeName(): string {
        return this.context.schema.actionAttribute + '-portalled';
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
        const actionAttributeName = this.getActionAttributeName();
        const portalledActionAttributeName = this.getPortalledActionAttributeName();
        const actionsToProxy = [];
        const actionsToDeleteProxyMethods = [];
        const newAttributeValueTokens = [];
        const newPortalledAttributeValueTokens = [];
        if (!element.hasAttribute(actionAttributeName) && !element.hasAttribute(portalledActionAttributeName)) {
            const elementToActionsSet = this.elementToActionsMap.get(element);
            if (elementToActionsSet === undefined || elementToActionsSet.size === 0) {
                return;
            }
            for (const directive of elementToActionsSet) {
                const actionToElementsSet = this.actionToElementsMap.get(directive);
                if (actionToElementsSet === undefined || actionToElementsSet.size === 0) {
                    continue;
                }
                actionToElementsSet.delete(element);
                if (actionToElementsSet.size === 0) {
                    actionsToDeleteProxyMethods.push(this.parseActionToken(directive));
                }
            }
        }
        const actions = this.parseActions(element);
        for (const action of actions) {
            if (action.identifier === this.identifier) {
                continue;
            }
            const directive = action.toString();
            let actionToElementsSet = this.actionToElementsMap.get(directive);
            if (actionToElementsSet === undefined) {
                actionToElementsSet = new Set<Element>();
                this.actionToElementsMap.set(directive, actionToElementsSet);
            }
            let elementToActionsSet = this.elementToActionsMap.get(element);
            if (elementToActionsSet === undefined) {
                elementToActionsSet = new Set<string>();
                this.elementToActionsMap.set(element, elementToActionsSet);
            }
            if (this.identifiers.has(action.identifier)) {
                actionToElementsSet.add(element);
                elementToActionsSet.add(directive);
                actionsToProxy.push(action);
                newPortalledAttributeValueTokens.push(directive);
                continue;
            }
            newAttributeValueTokens.push(directive);
            actionToElementsSet.delete(element);
            elementToActionsSet.delete(directive);
            if (actionToElementsSet.size === 0) {
                actionsToDeleteProxyMethods.push(action);
            }
        }
        for (const action of actionsToDeleteProxyMethods) {
            const proxyActionName = this.getProxyActionName(action.method);
            if (typeof (this as any)[proxyActionName] === 'function') {
                delete (this as any)[proxyActionName];
            }
        }
        for (const action of actionsToProxy) {
            let identifierToActionElementsSet = this.identifierToActionElementsMap.get(action.identifier);
            if (identifierToActionElementsSet === undefined) {
                identifierToActionElementsSet = new Set<Element>();
                this.identifierToActionElementsMap.set(action.identifier, identifierToActionElementsSet);
            }
            identifierToActionElementsSet.add(element);
            let actionElementToIdentifiersSet = this.actionElementToIdentifiersMap.get(element);
            if (actionElementToIdentifiersSet === undefined) {
                actionElementToIdentifiersSet = new Set<string>();
                this.actionElementToIdentifiersMap.set(element, actionElementToIdentifiersSet);
            }
            actionElementToIdentifiersSet.add(action.identifier);
            const proxyAction = this.toProxyAction(action);
            newAttributeValueTokens.push(proxyAction.toString());
            if (typeof (this as any)[proxyAction.method] === 'function') {
                continue;
            }
            (this as any)[proxyAction.method] = (event: ActionEvent): void => {
                const target = event.currentTarget;
                if (!(target instanceof Element)) {
                    console.warn(`Proxy action "${proxyAction.method}" called on non-element target`, event);
                    return;
                }
                const targetActions = this.parseActions(target);
                for (const targetAction of targetActions) {
                    if (targetAction.identifier === this.identifier || targetAction.method !== action.method) {
                        continue;
                    }
                    const controllers = this.controllers.get(targetAction.identifier);
                    if (controllers === undefined) {
                        continue;
                    }
                    event.params = this.getActionParams(target, targetAction.identifier);
                    for (const controller of controllers) {
                        try {
                            controller.context.invokeControllerMethod(targetAction.method, event);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
            }
        }
        this.setAttributeValue(element, actionAttributeName, newAttributeValueTokens.join(' '));
        this.setAttributeValue(element, portalledActionAttributeName, newPortalledAttributeValueTokens.join(' '));
    }

    private removeActionElement(element: Element, forceActionsAttributeRemoval: boolean = false): void {
        const actionsToDeleteProxyMethods = [];
        const newAttributeValueTokens = [];
        const actions = this.parseActions(element);
        this.elementToActionsMap.delete(element);
        const actionElementToIdentifiersSet = this.actionElementToIdentifiersMap.get(element);
        if (actionElementToIdentifiersSet !== undefined) {
            for (const identifier of actionElementToIdentifiersSet) {
                const identifierToActionElementsSet = this.identifierToActionElementsMap.get(identifier);
                if (identifierToActionElementsSet !== undefined) {
                    identifierToActionElementsSet.delete(element);
                    if (identifierToActionElementsSet.size === 0) {
                        this.identifierToActionElementsMap.delete(identifier);
                    }
                }
            }
            this.actionElementToIdentifiersMap.delete(element);
        }
        for (const action of actions) {
            if (action.identifier === this.identifier) {
                continue;
            }
            const directive = action.toString();
            if (!forceActionsAttributeRemoval) {
                newAttributeValueTokens.push(directive);
            }
            const actionToElementsSet = this.actionToElementsMap.get(directive);
            if (actionToElementsSet !== undefined) {
                actionToElementsSet.delete(element);
                if (actionToElementsSet.size === 0) {
                    this.actionToElementsMap.delete(directive);
                    actionsToDeleteProxyMethods.push(action);
                }
            }
        }
        for (const action of actionsToDeleteProxyMethods) {
            const proxyActionName = this.getProxyActionName(action.method);
            if (typeof (this as any)[proxyActionName] === 'function') {
                delete (this as any)[proxyActionName];
            }
        }
        this.setAttributeValue(element, this.getActionAttributeName(), newAttributeValueTokens.join(' '));
        this.setAttributeValue(element, this.getPortalledActionAttributeName(), null);
    }

    private removeAllProxyActions(): void {
        for (const identifier of this.identifiers) {
            this.removeAllProxyActionsByIdentifier(identifier);
        }
    }

    private removeAllProxyActionsByIdentifier(identifier: string): void {
        const elements = this.identifierToActionElementsMap.get(identifier);
        if (elements === undefined) {
            return;
        }
        for (const element of elements) {
            this.removeActionElement(element);
        }
        this.identifierToActionElementsMap.delete(identifier);
    }

    private parseActions(element: Element): Action[] {
        let attributeValue = '';
        const actionAttributeName = this.getActionAttributeName();
        const portalledActionAttributeName = this.getPortalledActionAttributeName();
        if (element.hasAttribute(actionAttributeName)) {
            attributeValue = (attributeValue + ' ' + element.getAttribute(actionAttributeName)!).trim();
        }
        if (element.hasAttribute(portalledActionAttributeName)) {
            attributeValue = (attributeValue + ' ' + element.getAttribute(portalledActionAttributeName)!).trim();
        }
        attributeValue = attributeValue.trim();
        if (attributeValue === '') {
            return [];
        }
        const actions: Action[] = [];
        const tokens = attributeValue.split(' ');
        for (let token of tokens) {
            token = token.trim();
            if (token === '') {
                continue;
            }
            actions.push(this.parseActionToken(token));
        }
        return actions;
    }

    private parseActionToken(token: string): Action {
        let [event, rest]: (string | undefined)[] = token.split('->');
        if (rest === undefined) {
            rest = event;
            event = undefined;
        }
        const [identifier, methodDetails] = rest.split('#');
        const [method, modifier] = methodDetails.split(':');
        return new Action(event, identifier, method, modifier, token);
    }

    private getProxyActionName(action: string): string {
        return `${proxyActionPrefix}${action}`;
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

    private toProxyAction(action: Action): Action {
        return new Action(
            action.event,
            this.identifier,
            this.getProxyActionName(action.method),
            action.modifier,
        );
    }

    private setAttributeValue(element: Element, attributeName: string, value: string | null): void {
        value = value === null ? '' : value.trim();
        if (value === '' && element.hasAttribute(attributeName)) {
            element.removeAttribute(attributeName);
        } else if (value !== '' && !element.hasAttribute(attributeName)) {
            element.setAttribute(attributeName, value);
        } else if (value !== '' && element.getAttribute(attributeName) !== value) {
            element.setAttribute(attributeName, value);
        }
    }
}
