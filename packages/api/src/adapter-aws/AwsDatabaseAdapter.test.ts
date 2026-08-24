import {describe, expect, test} from 'bun:test'
import {CreateDBInstanceCommand, DeleteDBInstanceCommand, ListTagsForResourceCommand, type RDSClient} from '@aws-sdk/client-rds'
import {ValidationError} from '../cloud-spi/errors'
import {AwsDatabaseAdapter} from './AwsDatabaseAdapter'
import type {RdsInstance} from '../services/rds'

/**
 * Covers the create path added when RDS stopped being read-only. The schema
 * advertises `create`, and cloudProxy.test.ts already enforces that an
 * advertised action has a method — these tests pin what the method does with it.
 */

const VALID = {
    dbInstanceIdentifier: 'demo-pg',
    engine: 'postgres',
    dbInstanceClass: 'db.t3.micro',
    allocatedStorage: '20',
    masterUsername: 'floci',
    masterUserPassword: 'floci1234',
}

function instance(overrides: Partial<RdsInstance> = {}): RdsInstance {
    return {
        identifier: 'demo-pg',
        status: 'available',
        engine: 'postgres',
        engineVersion: '16.3',
        instanceClass: 'db.t3.micro',
        arn: 'arn:aws:rds:us-east-1:000000000000:db:demo-pg',
        ...overrides,
    } as RdsInstance
}

/** Records the commands sent so assertions can read the real SDK input. */
function stubRds() {
    const sent: unknown[] = []
    const client = {
        send: async (command: unknown) => {
            sent.push(command)
            if (command instanceof CreateDBInstanceCommand) {
                return {DBInstance: {DBInstanceIdentifier: command.input.DBInstanceIdentifier}}
            }
            if (command instanceof ListTagsForResourceCommand) return {TagList: []}
            return {}
        },
    } as unknown as RDSClient
    return {client, sent}
}

function adapter(overrides: {describe?: (id: string) => Promise<RdsInstance>} = {}) {
    const {client, sent} = stubRds()
    const svc = {
        listInstances: async () => [instance()],
        describeInstance: overrides.describe ?? (async () => instance()),
    }
    return {adapter: new AwsDatabaseAdapter(svc, client), sent}
}

describe('AwsDatabaseAdapter.create', () => {
    test('sends the values through to CreateDBInstance', async () => {
        const {adapter: a, sent} = adapter()
        await a.create({values: VALID})

        const command = sent.find((c) => c instanceof CreateDBInstanceCommand) as CreateDBInstanceCommand
        expect(command.input).toMatchObject({
            DBInstanceIdentifier: 'demo-pg',
            DBInstanceClass: 'db.t3.micro',
            Engine: 'postgres',
            MasterUsername: 'floci',
            MasterUserPassword: 'floci1234',
            AllocatedStorage: 20,
        })
    })

    // AllocatedStorage is a select of strings in the schema because FieldType has
    // no numeric kind; the SDK needs a number.
    test('coerces the allocated storage select value to a number', async () => {
        const {adapter: a, sent} = adapter()
        await a.create({values: {...VALID, allocatedStorage: '100'}})
        const command = sent.find((c) => c instanceof CreateDBInstanceCommand) as CreateDBInstanceCommand
        expect(command.input.AllocatedStorage).toBe(100)
    })

    test('returns the normalized resource rather than the raw SDK response', async () => {
        const {adapter: a} = adapter()
        const resource = await a.create({values: VALID})

        expect(resource).toMatchObject({
            id: 'demo-pg',
            name: 'demo-pg',
            cloud: 'aws',
            service: 'database',
            type: 'db-instance',
            engine: 'postgres',
            version: '16.3',
        })
    })

    test('accepts every engine the schema offers', async () => {
        for (const engine of ['postgres', 'mysql', 'mariadb']) {
            const {adapter: a, sent} = adapter()
            await a.create({values: {...VALID, engine}})
            const command = sent.find((c) => c instanceof CreateDBInstanceCommand) as CreateDBInstanceCommand
            expect(command.input.Engine).toBe(engine)
        }
    })

    test('trims surrounding whitespace instead of rejecting it', async () => {
        const {adapter: a, sent} = adapter()
        await a.create({values: {...VALID, dbInstanceIdentifier: '  demo-pg  '}})
        const command = sent.find((c) => c instanceof CreateDBInstanceCommand) as CreateDBInstanceCommand
        expect(command.input.DBInstanceIdentifier).toBe('demo-pg')
    })
})

describe('AwsDatabaseAdapter.create validation', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['a missing identifier', {...VALID, dbInstanceIdentifier: ''}],
        ['an identifier starting with a digit', {...VALID, dbInstanceIdentifier: '1demo'}],
        ['an identifier with uppercase letters', {...VALID, dbInstanceIdentifier: 'Demo'}],
        ['an identifier with consecutive hyphens', {...VALID, dbInstanceIdentifier: 'demo--pg'}],
        ['an identifier ending in a hyphen', {...VALID, dbInstanceIdentifier: 'demo-'}],
        ['an unsupported engine', {...VALID, engine: 'oracle-se2'}],
        ['a missing instance class', {...VALID, dbInstanceClass: ''}],
        ['a missing username', {...VALID, masterUsername: ''}],
        ['a short password', {...VALID, masterUserPassword: 'short'}],
        ['a non-numeric storage size', {...VALID, allocatedStorage: 'twenty'}],
        ['a storage size below the RDS minimum', {...VALID, allocatedStorage: '5'}],
    ]

    for (const [label, values] of cases) {
        test(`rejects ${label}`, async () => {
            const {adapter: a, sent} = adapter()
            await expect(a.create({values})).rejects.toBeInstanceOf(ValidationError)
            // Rejected before any SDK call, so nothing is half-created.
            expect(sent.filter((c) => c instanceof CreateDBInstanceCommand)).toHaveLength(0)
        })
    }
})

describe('AwsDatabaseAdapter.delete', () => {
    test('sends DeleteDBInstance for the given identifier', async () => {
        const {adapter: a, sent} = adapter()
        await a.delete('demo-pg')

        const command = sent.find((c) => c instanceof DeleteDBInstanceCommand) as DeleteDBInstanceCommand
        expect(command.input.DBInstanceIdentifier).toBe('demo-pg')
    })

    // Without SkipFinalSnapshot, RDS demands a FinalDBSnapshotIdentifier and the
    // call fails — snapshotting a throwaway local instance is pure friction.
    test('skips the final snapshot and the automated backups', async () => {
        const {adapter: a, sent} = adapter()
        await a.delete('demo-pg')

        const command = sent.find((c) => c instanceof DeleteDBInstanceCommand) as DeleteDBInstanceCommand
        expect(command.input.SkipFinalSnapshot).toBe(true)
        expect(command.input.DeleteAutomatedBackups).toBe(true)
    })

    test('trims the identifier', async () => {
        const {adapter: a, sent} = adapter()
        await a.delete('  demo-pg  ')
        const command = sent.find((c) => c instanceof DeleteDBInstanceCommand) as DeleteDBInstanceCommand
        expect(command.input.DBInstanceIdentifier).toBe('demo-pg')
    })

    test('rejects an empty identifier before calling the SDK', async () => {
        const {adapter: a, sent} = adapter()
        await expect(a.delete('   ')).rejects.toBeInstanceOf(ValidationError)
        expect(sent.filter((c) => c instanceof DeleteDBInstanceCommand)).toHaveLength(0)
    })

    // A runtime rejection must surface, not be swallowed: the console shows the
    // row as gone otherwise.
    test('propagates a runtime failure', async () => {
        const failing = {
            send: async () => {
                throw new Error('InvalidDBInstanceState: instance is already being deleted')
            },
        } as unknown as RDSClient
        const a = new AwsDatabaseAdapter(
            {listInstances: async () => [], describeInstance: async () => instance()},
            failing,
        )
        await expect(a.delete('demo-pg')).rejects.toThrow('InvalidDBInstanceState')
    })
})

describe('AwsDatabaseAdapter schema', () => {
    test('advertises the full CRUD set it implements', () => {
        const {adapter: a} = adapter()
        expect(a.schema().actions).toEqual(['list', 'inspect', 'create', 'delete'])
    })

    // The adapter re-checks what the form already validates, so a direct API
    // call cannot bypass the pattern the UI enforces.
    test('the schema pattern and the adapter check agree', () => {
        const {adapter: a} = adapter()
        const field = a.schema().fields.find((f) => f.name === 'dbInstanceIdentifier')
        const pattern = new RegExp(field!.validation!.pattern!)

        for (const good of ['demo-pg', 'a', 'db-1-x']) expect(pattern.test(good)).toBe(true)
        for (const bad of ['1demo', 'Demo', 'demo--pg', 'demo-']) expect(pattern.test(bad)).toBe(false)
    })
})
