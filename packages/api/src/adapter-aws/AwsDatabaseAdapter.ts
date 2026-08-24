import {NotSupportedError, ValidationError} from '../cloud-spi/errors'
import {CreateDBInstanceCommand, DeleteDBInstanceCommand, ListTagsForResourceCommand, type RDSClient} from '@aws-sdk/client-rds'
import {rds as defaultRds} from '../aws'
import {awsDatabaseSchema} from '../cloud-spi/databaseSchema'
import type {
    CloudResource,
    CloudServiceAdapter,
    CreateResourceInput,
    ResourceQuery,
    ServiceSchema,
} from '../cloud-spi/types'
import {rdsService, type RdsInstance} from '../services/rds'

type RdsServiceShape = Pick<typeof rdsService, 'listInstances' | 'describeInstance'>

export class AwsDatabaseAdapter implements CloudServiceAdapter {
    readonly cloud = 'aws' as const
    readonly service = 'database' as const

    constructor(
        private readonly rdsService_: RdsServiceShape = rdsService,
        private readonly rds: RDSClient = defaultRds,
    ) {}

    schema(): ServiceSchema {
        return awsDatabaseSchema()
    }

    async list(query: ResourceQuery = {}): Promise<CloudResource[]> {
        const instances = await this.rdsService_.listInstances()
        const resources = await Promise.all(instances.map((instance) => this.toResource(instance)))
        return filterBySearch(resources, query.search)
    }

    async get(id: string): Promise<CloudResource | null> {
        try {
            return await this.toResource(await this.rdsService_.describeInstance(id))
        } catch (error) {
            if (hasHttpStatus(error, 404)) return null
            throw error
        }
    }

    async create(input: CreateResourceInput): Promise<CloudResource> {
        const identifier = requiredString(input.values.dbInstanceIdentifier, 'dbInstanceIdentifier')
        if (!IDENTIFIER_PATTERN.test(identifier)) {
            throw new ValidationError('Use a valid RDS identifier: start with a letter, then lowercase letters, numbers, or single hyphens.')
        }

        const engine = oneOf(input.values.engine, ENGINES, 'engine')
        const instanceClass = requiredString(input.values.dbInstanceClass, 'dbInstanceClass')
        const masterUsername = requiredString(input.values.masterUsername, 'masterUsername')
        const masterUserPassword = requiredString(input.values.masterUserPassword, 'masterUserPassword')
        if (masterUserPassword.length < 8) {
            throw new ValidationError('masterUserPassword must be at least 8 characters')
        }

        const allocatedStorage = Number(requiredString(input.values.allocatedStorage, 'allocatedStorage'))
        if (!Number.isInteger(allocatedStorage) || allocatedStorage < 20) {
            throw new ValidationError('allocatedStorage must be an integer of at least 20')
        }

        const res = await this.rds.send(new CreateDBInstanceCommand({
            DBInstanceIdentifier: identifier,
            DBInstanceClass: instanceClass,
            Engine: engine,
            MasterUsername: masterUsername,
            MasterUserPassword: masterUserPassword,
            AllocatedStorage: allocatedStorage,
        }))

        // The create response carries the same shape `list` normalizes, but the
        // runtime omits tags on it, so re-describe rather than half-fill a
        // resource the inspector would then render with gaps.
        const created = res.DBInstance?.DBInstanceIdentifier ?? identifier
        const resource = await this.get(created)
        if (resource) return resource

        throw new NotSupportedError(`RDS reported no instance for ${created} after creation.`)
    }

    async delete(id: string): Promise<void> {
        // SkipFinalSnapshot is required unless a FinalDBSnapshotIdentifier is
        // given, and a snapshot of a throwaway local instance is pure friction.
        // DeleteAutomatedBackups matches: nothing here is worth retaining.
        await this.rds.send(new DeleteDBInstanceCommand({
            DBInstanceIdentifier: requiredString(id, 'id'),
            SkipFinalSnapshot: true,
            DeleteAutomatedBackups: true,
        }))
    }

    private async toResource(instance: RdsInstance): Promise<CloudResource> {
        const tags = instance.arn ? await this.getTags(instance.arn) : []

        return {
        id: instance.identifier,
        name: instance.identifier,
        cloud: 'aws',
        service: 'database',
        type: 'db-instance',
        region: instance.availabilityZone ?? null,
        createdAt: instance.createdAt ?? null,
        status: instance.status ?? null,
        version: instance.engineVersion ?? null,
        engine: instance.engine ?? null,
        instanceClass: instance.instanceClass ?? null,
        metadata: {
            arn: instance.arn,
            resourceId: instance.resourceId,
            dbName: instance.dbName,
            masterUsername: instance.masterUsername,
            allocatedStorage: instance.allocatedStorage,
            storageType: instance.storageType,
            endpoint: instance.endpoint,
            multiAz: instance.multiAz,
            publiclyAccessible: instance.publiclyAccessible,
            iamDatabaseAuthenticationEnabled: instance.iamDatabaseAuthenticationEnabled,
            preferredBackupWindow: instance.preferredBackupWindow,
            preferredMaintenanceWindow: instance.preferredMaintenanceWindow,
            vpcSecurityGroups: instance.vpcSecurityGroups,
            subnetGroup: instance.subnetGroup,
            tags,
        },
        }
    }

    private async getTags(arn: string): Promise<Array<{key: string; value: string}>> {
        try {
            const res = await this.rds.send(new ListTagsForResourceCommand({ResourceName: arn}))
            return (res.TagList ?? []).map((tag) => ({
                key: tag.Key ?? '',
                value: tag.Value ?? '',
            }))
        } catch (error) {
            if (error instanceof Error && error.message.includes('ListTagsForResource is not supported')) return []
            throw error
        }
    }
}

function filterBySearch(resources: CloudResource[], search?: string): CloudResource[] {
    const normalized = search?.trim().toLowerCase()
    if (!normalized) return resources
    return resources.filter((resource) => resource.name.toLowerCase().includes(normalized))
}

function hasHttpStatus(error: unknown, status: number): boolean {
    if (typeof error !== 'object' || error === null) return false
    const metadata = (error as {$metadata?: {httpStatusCode?: number}}).$metadata
    return metadata?.httpStatusCode === status
}

const ENGINES = ['postgres', 'mysql', 'mariadb'] as const

/** Mirrors the pattern the schema advertises, so both reject the same inputs. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ValidationError(`${field} is required`)
    }
    return value.trim()
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    const raw = requiredString(value, field)
    const match = allowed.find((candidate) => candidate === raw)
    if (!match) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
    return match
}
