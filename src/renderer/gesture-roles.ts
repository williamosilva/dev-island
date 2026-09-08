/**
 * What a pointer press on an element means.
 *
 * The role is read from the element under the pointer, never from coordinates,
 * so a control keeps its click, a script starts a reorder and everything else
 * moves the window.
 */

export const GESTURE_ATTRIBUTE = 'data-di-gesture';

export type GestureRole = 'free' | 'block' | 'reorder';

/**
 * A press has to travel this far before it stops being a click.
 * Below it, pressing a script still runs the script.
 */
export const GESTURE_THRESHOLD_PX = 5;
