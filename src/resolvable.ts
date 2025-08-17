import {Application, Controller} from "@hotwired/stimulus";
import {getController, getControllerAsync} from "./utils";

type Constructor<T = {}> = new (...args: any[]) => T;

const identifierToAppMap = new Map<string, Application>();

export function Resolvable<Base extends Constructor<Controller>>(Base: Base, identifier: string) {
    return class extends Base
    {
        constructor(...args: any[]) {
            super(...args);

            const originalConnect = (this as any).connect;
            (this as any).connect = function (): void {
                identifierToAppMap.set(this.identifier, this.application);
                if (typeof originalConnect === 'function') {
                    originalConnect.call(this);
                }
            }
        }

        public static get<T extends Constructor<Controller>>(this: T, element: HTMLElement): InstanceType<T> | null {
            const app = identifierToAppMap.get(identifier);
            if (typeof app === 'undefined') {
                return null;
            }
            return getController(app, element, identifier) as InstanceType<T> | null;
        }

        public static getAsync<T extends Constructor<Controller>>(
            this: T,
            element: HTMLElement,
            timeout: number = 5000,
            poll: number = 50,
        ): Promise<InstanceType<T> | null> {
            const app = identifierToAppMap.get(identifier);
            if (typeof app !== 'undefined') {
                return getControllerAsync(app, element, identifier, timeout, poll) as Promise<InstanceType<T> | null>;
            }
            const startTime = Date.now();
            const maxAttempts = 10;
            let attempts = 0;
            return new Promise((resolve) => {
                const checkApp = async () => {
                    attempts++;
                    const app = identifierToAppMap.get(identifier);
                    if (typeof app !== 'undefined') {
                        const remainingTime = timeout - (Date.now() - startTime);
                        remainingTime <= 0
                            ? resolve(getController(app, element, identifier) as InstanceType<T> | null)
                            : resolve(await getControllerAsync(app, element, identifier, remainingTime, poll));
                    } else if (Date.now() - startTime >= timeout) {
                        resolve(null);
                    } else if (attempts <= maxAttempts) {
                        setTimeout(checkApp);
                    } else {
                        setTimeout(checkApp, poll);
                    }
                };
                checkApp().catch(error => console.error(error));
            });
        }
    }
}
