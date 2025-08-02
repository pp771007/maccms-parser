"use strict";

import { $ } from './utils.js';

class HistoryManager {
    constructor() {
        this.stateStack = [];
        this.isReverting = false; // Flag to prevent loops
        window.addEventListener('popstate', this.handlePopState.bind(this));
    }

    /**
     * Adds a new state to the history stack.
     * @param {object} state - The state object.
     * @param {string} state.id - A unique identifier for the state.
     * @param {function} state.apply - Function to execute when opening the UI element.
     * @param {function} state.revert - Function to execute when closing the UI element.
     * @param {object} [state.context] - Optional context data for the state.
     */
    add(state) {
        if (this.isReverting) return;

        // Prevent adding duplicate states
        if (this.stateStack.length > 0 && this.stateStack[this.stateStack.length - 1].id === state.id) {
            return;
        }

        // Apply the new state
        if (state.apply) {
            state.apply(state.context);
        }

        // Push to our internal stack
        this.stateStack.push(state);

        // Push to browser history
        history.pushState({ id: state.id, index: this.stateStack.length - 1 }, '');
    }

    /**
     * Handles the browser's popstate event (e.g., back button).
     */
    handlePopState(event) {
        if (this.stateStack.length === 0) {
            // If our stack is empty, but popstate is triggered, it might be an initial page load state.
            // We can push a base state to prevent unexpected behavior on subsequent back presses.
            if (history.state === null) {
                history.pushState({ id: 'base', index: -1 }, '');
            }
            return;
        }

        this.isReverting = true;

        const currentState = this.stateStack.pop();
        if (currentState && currentState.revert) {
            currentState.revert(currentState.context);
        }

        this.isReverting = false;
    }

    /**
     * Programmatically triggers a history back action.
     */
    back() {
        history.back();
    }

    /**
     * Clears the history stack. Useful when closing multiple states at once.
     */
    clear() {
        this.stateStack = [];
        // This doesn't clear the browser history, but aligns our internal stack.
        // A more robust implementation might involve replacing the state.
        history.replaceState({ id: 'base', index: -1 }, '');
    }

    /**
     * Gets the current active state.
     * @returns {object|null} The current state object or null.
     */
    getCurrentState() {
        if (this.stateStack.length > 0) {
            return this.stateStack[this.stateStack.length - 1];
        }
        return null;
    }
}

const historyManager = new HistoryManager();
export default historyManager;
