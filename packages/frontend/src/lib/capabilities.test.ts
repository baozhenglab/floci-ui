import {describe, expect, test} from 'vitest'
import {
    capabilityEnabled,
    capabilityFor,
    normalizeCapabilities,
    withRuntimeState,
    withServiceAvailability,
} from './capabilities'
import type {CapabilitySchema, ObjectActionName, ResourceActionName} from '@/types/schema'

/**
 * These cover the contract the whole console is built on: the server describes
 * what a service can do, and the UI must render exactly that — no more, and
 * never a control whose reason it has dropped.
 */

function cap(
    name: ResourceActionName,
    overrides: Partial<CapabilitySchema<ResourceActionName>> = {},
): CapabilitySchema<ResourceActionName> {
    return {name, label: name, enabled: true, status: 'available', ...overrides}
}

describe('normalizeCapabilities', () => {
    test('expands a bare action string into an enabled capability', () => {
        expect(normalizeCapabilities<ResourceActionName>(['create'])).toEqual([
            {name: 'create', label: 'Create', enabled: true, status: 'available', runtimeRequired: true},
        ])
    })

    test('passes an already-structured capability through untouched', () => {
        const structured = cap('delete', {enabled: false, status: 'coming_soon', reason: 'not wired'})
        expect(normalizeCapabilities<ResourceActionName>([structured])[0]).toBe(structured)
    })

    test('defaults to an empty list so a schema without capabilities renders no actions', () => {
        expect(normalizeCapabilities()).toEqual([])
    })

    // Asserts the mapping itself: a truthiness check would pass with every verb
    // mislabelled, and these strings are what the operator reads on the button.
    test('maps every resource verb to its display label', () => {
        const verbs: ResourceActionName[] = [
            'list', 'create', 'delete', 'inspect', 'invoke', 'start', 'stop', 'reboot', 'updateTags',
        ]
        expect(normalizeCapabilities<ResourceActionName>(verbs).map((c) => c.label)).toEqual([
            'List', 'Create', 'Delete', 'Inspect', 'Invoke', 'Start', 'Stop', 'Reboot', 'Edit tags',
        ])
    })

    test('maps every object verb to its display label', () => {
        const verbs: ObjectActionName[] = ['list', 'upload', 'download', 'delete', 'createFolder', 'copy']
        expect(normalizeCapabilities<ObjectActionName>(verbs).map((c) => c.label)).toEqual([
            'List', 'Upload', 'Download', 'Delete', 'Create folder', 'Copy object',
        ])
    })
})

describe('capabilityFor', () => {
    test('finds a capability by action name', () => {
        expect(capabilityFor([cap('list'), cap('create')], 'create')?.name).toBe('create')
    })

    test('returns undefined for an action the service never advertised', () => {
        expect(capabilityFor([cap('list')], 'delete')).toBeUndefined()
    })
})

describe('capabilityEnabled', () => {
    test('enables an available capability', () => {
        expect(capabilityEnabled(cap('create'))).toBe(true)
    })

    // An undefined capability is the "server never mentioned it" case: the UI
    // must not invent the control.
    test('disables an undefined capability', () => {
        expect(capabilityEnabled(undefined)).toBe(false)
    })

    test('disables an explicitly disabled capability', () => {
        expect(capabilityEnabled(cap('create', {enabled: false}))).toBe(false)
    })

    test('disables a blocked capability even when the enabled flag is true', () => {
        expect(capabilityEnabled(cap('create', {status: 'blocked'}))).toBe(false)
    })

    test('disables a coming_soon capability even when the enabled flag is true', () => {
        expect(capabilityEnabled(cap('invoke', {status: 'coming_soon'}))).toBe(false)
    })

    // `partial` is how AWS networking advertises create/delete: the verb works,
    // but through a provider-specific panel rather than the generic form.
    test('keeps a partial capability enabled', () => {
        expect(capabilityEnabled(cap('create', {status: 'partial'}))).toBe(true)
    })
})

describe('withRuntimeState', () => {
    test('blocks runtime-dependent actions with an actionable reason when the runtime is down', () => {
        const [blocked] = withRuntimeState([cap('create', {runtimeRequired: true})], false)
        expect(blocked.enabled).toBe(false)
        expect(blocked.status).toBe('blocked')
        expect(blocked.reason).toBe('Start the selected runtime before using this action.')
    })

    test('leaves actions untouched while the runtime is reachable', () => {
        const input = [cap('create', {runtimeRequired: true})]
        expect(withRuntimeState(input, true)[0]).toBe(input[0])
    })

    test('leaves actions that do not need the runtime alone while it is down', () => {
        const input = [cap('inspect', {runtimeRequired: false})]
        expect(withRuntimeState(input, false)[0]).toBe(input[0])
    })

    test('does not mutate the capability it blocks', () => {
        const input = cap('create', {runtimeRequired: true})
        withRuntimeState([input], false)
        expect(input.enabled).toBe(true)
        expect(input.reason).toBeUndefined()
    })
})

describe('withServiceAvailability', () => {
    test('returns capabilities unchanged for an available service', () => {
        const input = [cap('create')]
        expect(withServiceAvailability(input, 'available')).toBe(input)
    })

    // A schema can exist with no adapter behind it (iac today). Every
    // action must go coming_soon and carry the explanation.
    test('marks every action coming_soon with a reason when no adapter is registered', () => {
        const [only] = withServiceAvailability([cap('create')], 'coming_soon')
        expect(only.enabled).toBe(false)
        expect(only.status).toBe('coming_soon')
        expect(only.reason).toContain('no runtime adapter is registered')
    })

    test('never leaves an action enabled for an unavailable service', () => {
        const result = withServiceAvailability(
            [cap('list'), cap('create', {status: 'partial'}), cap('delete')],
            'coming_soon',
        )
        expect(result.every((c) => !capabilityEnabled(c))).toBe(true)
    })
})

describe('capability pipeline', () => {
    // The order the views apply these in: shorthand -> service availability ->
    // runtime state. The reason shown must be the most specific one that applies.
    test('an unavailable service outranks a reachable runtime', () => {
        const [result] = withRuntimeState(
            withServiceAvailability(normalizeCapabilities<ResourceActionName>(['create']), 'coming_soon'),
            true,
        )
        expect(capabilityEnabled(result)).toBe(false)
        expect(result.reason).toContain('no runtime adapter is registered')
    })

    test('an available service with a dead runtime reports the runtime as the blocker', () => {
        const [result] = withRuntimeState(
            withServiceAvailability(normalizeCapabilities<ResourceActionName>(['create']), 'available'),
            false,
        )
        expect(capabilityEnabled(result)).toBe(false)
        expect(result.reason).toBe('Start the selected runtime before using this action.')
    })

    test('an available service on a live runtime enables the action', () => {
        const [result] = withRuntimeState(
            withServiceAvailability(normalizeCapabilities<ResourceActionName>(['create']), 'available'),
            true,
        )
        expect(capabilityEnabled(result)).toBe(true)
    })
})
