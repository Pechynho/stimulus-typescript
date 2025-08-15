import {ActionEvent, Application, Controller} from "@hotwired/stimulus";

export const camelCase = (value: string): string => {
    return value
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, c => c.toLowerCase());
};

export const capitalize = (value: string): string => {
    return value.charAt(0).toUpperCase() + value.slice(1);
};

export const isActionEvent = (value: any): value is ActionEvent => {
    return value instanceof Event && 'params' in value && typeof value.params !== 'object';
}

export const getController = <T extends Controller>(app: Application, element: HTMLElement, identifier: string): T | null => {
    return app.getControllerForElementAndIdentifier(element, identifier) as T | null;
}

export const getControllerAsync = async <T extends Controller>(app: Application, element: HTMLElement, identifier: string, timeout: number = 5000, poll: number = 50): Promise<T | null> => {
    const startTime = Date.now();
    let attempts = 0;
    let maxAttempts = 10;
    return new Promise((resolve, reject) => {
        const checkController = () => {
            attempts++;
            const controller = app.getControllerForElementAndIdentifier(element, identifier) as T | null;
            if (controller !== null) {
                resolve(controller);
            } else if (Date.now() - startTime >= timeout) {
                reject(`Controller ${identifier} not found`);
            } else if (attempts <= maxAttempts) {
                setTimeout(checkController);
            } else {
                setTimeout(checkController, poll);
            }
        };
        checkController();
    });
};
