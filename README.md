# Stimulus TypeScript

This project is based on the following projects:

- [stimulus-typescript](https://github.com/ajaishankar/stimulus-typescript/tree/main) by Ajai Shankar
- [headless-components-rails](https://github.com/Tonksthebear/headless-components-rails) by Tonksthebear

We would like to thank the authors of these projects for their work, which served as the foundation for this package.

## MIT Licenses of Original Projects

- [stimulus-typescript MIT License](https://github.com/ajaishankar/stimulus-typescript/tree/main?tab=MIT-1-ov-file)
- [headless-components-rails MIT License](https://github.com/Tonksthebear/headless-components-rails?tab=MIT-1-ov-file)

## Usage

This package provides strongly typed Stimulus controllers with TypeScript, offering type safety for values, targets, classes, outlets, and portals.

### Basic Usage

```typescript
import {Controller} from '@hotwired/stimulus';
import {Target, Typed, TypedArray, TypedObject} from '@pechynho/stimulus-typescript';
import {UserStatusController} from './user-status-controller';
import {CustomElement} from './custom-element';

class HomepageController extends Typed(
    Controller<HTMLElement>, {
        values: {
            name: String,
            counter: Number,
            isActive: Boolean,
            alias: TypedArray<string>(),
            address: TypedObject<{ street: string }>(),
        },
        targets: {
            form: HTMLFormElement,
            select: HTMLSelectElement,
            custom: Target<CustomElement>(),
        },
        classes: ['selected', 'highlighted'] as const,
        outlets: {'user-status': UserStatusController},
    }
)
{
    // All properties are now strongly typed!

    public connect(): void {
        // String values
        this.nameValue.split(' ');

        // Number values
        Math.floor(this.counterValue);

        // Boolean values
        this.isActiveValue;

        // Array values
        this.aliasValue.map(alias => alias.toUpperCase());

        // Object values
        console.log(this.addressValue.street);

        // Targets
        this.formTarget.submit();
        this.selectTarget.value = 'stimulus';
        this.customTarget.someCustomMethod();

        // Outlets
        this.userStatusOutlets.forEach(status => status.markAsSelected(event));

        // Classes
        if (this.hasSelectedClass) {
            console.log(this.selectedClass);
        }
    }
}
```

### Type Definitions

#### Values

The `values` object defines the types of values that can be set on your controller:

```typescript
import {TypedArray, TypedObject} from "./typed-stimulus";

const values = {
    // Basic types
    name: String, // string
    count: Number, // number
    isActive: Boolean, // boolean

    // Array types
    tags: TypedArray<string>(), // string[]
    scores: TypedArray<number>(), // number[]

    // Custom object type
    user: TypedObject<{
        firstName: string,
        lastName: string,
        age: number
    }>()
};
```

#### Targets

The `targets` object defines the HTML elements that your controller can target:

```typescript
import {Target} from '@pechynho/stimulus-typescript';
import {CustomElement} from './custom-element';

const targets = {
  form: HTMLFormElement, // <div data-homepage-controller-target="form"></div>
  button: HTMLButtonElement, // <button data-homepage-controller-targe="bubton"></button>
  input: HTMLInputElement, // <input data-homepage-controller-target="input">
  custom: Target<CustomElement>(), // <div data-homepage-controller-target="custom"></div>
}
```

#### Classes

The `classes` array defines CSS classes that your controller can add/remove:

```typescript
const classes = ['selected', 'highlighted', 'active'] as const;

// Usage:
this.hasSelectedClass // boolean
this.selectedClass // string (class name)
```

#### Outlets

The `outlets` object defines other controllers that your controller can communicate with:

```typescript
import {UserStatusController} from './user-status-controller';
import {NotificationController} from './notification-controller';

const outlets = {
  'user-status': UserStatusController,
  'notification': NotificationController
}

// Usage:
this.hasUserStatusOutlet // boolean
this.userStatusOutlet // UserStatusController
this.userStatusOutlets // UserStatusController[]
```

### Portals

When you define portals in your controller, the system:

1. Monitors these elements for targets and actions
2. Makes these targets available to your controller
3. Routes actions from these elements to your controller

This is especially useful for modals, sidebars, or any other elements that might be rendered outside your controller's DOM tree but still need to interact with your controller.

You need to register special `PortalController` to your Stimulus application:
```typescript
import { Application } from '@hotwired/stimulus';
import { PortalController } from '@pechynho/stimulus-typescript';

const app = Application.start(...); // Start your Stimulus application

app.register('portal', PortalController); // Register PortalController
```

#### Example

```typescript
import { Controller } from '@hotwired/stimulus';
import { Typed } from '@pechynho/stimulus-typescript';

class ModalController extends Typed(
    Controller<HTMLElement>, {
        targets: {
            content: HTMLDivElement
        },
        portals: true,
    }
) {
  public open(): void {
    // Even if #modal is outside this controller's DOM,
    // you can still access targets inside it
    this.contentTarget.classList.add('visible');
  }
  
  public close(): void {
    this.contentTarget.classList.remove('visible');
  }
}
```

In your HTML:

```html
<div data-controller="modal" data-modal-portal-selectors-value="[#modal]">
  <button data-action="modal#open">Open Modal</button>
</div>

<!-- This is outside the controller's DOM -->
<div id="modal">
  <div data-modal-target="content">
    Modal content here
    <button data-action="modal#close">Close</button>
  </div>
</div>
```

With portals, the ModalController can interact with elements inside #modal even though they're outside its DOM hierarchy.
