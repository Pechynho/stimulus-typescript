import {ActionEvent, Application, Controller} from "@hotwired/stimulus";

export const camelCase = (value: string): string => {
    return value
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, c => c.toLowerCase());
};

export const capitalize = (value: string): string => {
    return value.charAt(0).toUpperCase() + value.slice(1);
};

export function addStimulusAction(
    element: HTMLElement,
    identifier: string,
    method: string,
    event?: string,
    params?: Record<string, object | string | number | boolean>,
): void {
    const existing = element.dataset.action;
    const actions = existing !== undefined && existing.trim() !== ''
        ? existing.trim().split(/\s+/)
        : [];
    const target = `${identifier}#${method}`;
    const descriptor = event !== undefined ? `${event}->${target}` : target;
    if (!actions.includes(descriptor)) {
        actions.push(descriptor);
    }
    element.dataset.action = actions.join(' ');
    if (params !== undefined) {
        for (const [key, value] of Object.entries(params)) {
            element.dataset[`${camelCase(identifier)}${capitalize(camelCase(key))}Param`] = typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);
        }
    }
}

export function removeStimulusAction(
    element: HTMLElement,
    identifier: string,
    method: string,
    event?: string,
    removeParams: boolean | string[] = false,
): void {
    const existing = element.dataset.action;
    if (existing === undefined || existing.trim() === '') {
        return;
    }
    const target = `${identifier}#${method}`;
    const descriptor = event !== undefined ? `${event}->${target}` : target;
    const actions = existing.trim().split(/\s+/).filter((a) => a !== descriptor);
    if (actions.length > 0) {
        element.dataset.action = actions.join(' ');
    } else {
        delete element.dataset.action;
    }
    if (removeParams === false) {
        return;
    }
    const prefix = camelCase(identifier);
    if (Array.isArray(removeParams)) {
        for (const name of removeParams) {
            delete element.dataset[`${prefix}${capitalize(camelCase(name))}Param`];
        }
    } else {
        for (const key of Object.keys(element.dataset)) {
            if (key.startsWith(prefix) && key.endsWith('Param')) {
                delete element.dataset[key];
            }
        }
    }
}

export const isActionEvent = (value: any): value is ActionEvent => {
    return value instanceof Event && 'params' in value && typeof value.params === 'object';
}

export const getController = <T extends Controller>(app: Application, element: HTMLElement, identifier: string): T | null => {
    return app.getControllerForElementAndIdentifier(element, identifier) as T | null;
}

export const getControllerAsync = async <T extends Controller>(app: Application, element: HTMLElement, identifier: string, timeout: number = 5000, poll: number = 50): Promise<T | null> => {
    const startTime = Date.now();
    const maxAttempts = 10;
    let attempts = 0;
    return new Promise((resolve) => {
        const checkController = () => {
            attempts++;
            const controller = app.getControllerForElementAndIdentifier(element, identifier) as T | null;
            if (controller !== null) {
                resolve(controller);
            } else if (Date.now() - startTime >= timeout) {
                resolve(null);
            } else if (attempts <= maxAttempts) {
                setTimeout(checkController);
            } else {
                setTimeout(checkController, poll);
            }
        };
        checkController();
    });
};
