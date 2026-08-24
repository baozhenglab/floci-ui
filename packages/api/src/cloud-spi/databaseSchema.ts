import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const databaseColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status'},
    {name: 'engine', label: 'Engine'},
    {name: 'version', label: 'Version'},
    {name: 'instanceClass', label: 'Class'},
]

const databaseFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

/** Engines the Floci runtime provisions, with the version it reports for each. */
const engineOptions = [
    {label: 'PostgreSQL 16.3', value: 'postgres'},
    {label: 'MySQL 8.0', value: 'mysql'},
    {label: 'MariaDB 11.2', value: 'mariadb'},
]

const instanceClassOptions = ['db.t3.micro', 'db.t3.small', 'db.t3.medium'].map((value) => ({
    label: value,
    value,
}))

/**
 * Storage is a select rather than a text field: `FieldType` has no numeric kind,
 * and a free-text number would push integer validation into every consumer.
 */
const allocatedStorageOptions = ['20', '50', '100'].map((value) => ({label: `${value} GiB`, value}))

export function awsDatabaseSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'database',
        displayName: 'AWS RDS',
        fields: [
            {
                name: 'dbInstanceIdentifier',
                label: 'DB Instance Identifier',
                type: 'text',
                required: true,
                description: '1-63 characters. Must start with a letter; lowercase letters, numbers, and hyphens.',
                validation: {
                    pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
                    minLength: 1,
                    maxLength: 63,
                    message: 'Use a valid RDS identifier: start with a letter, then lowercase letters, numbers, or single hyphens.',
                },
            },
            {
                name: 'engine',
                label: 'Engine',
                type: 'select',
                required: true,
                options: engineOptions,
            },
            {
                name: 'dbInstanceClass',
                label: 'Instance Class',
                type: 'select',
                required: true,
                options: instanceClassOptions,
            },
            {
                name: 'allocatedStorage',
                label: 'Allocated Storage',
                type: 'select',
                required: true,
                options: allocatedStorageOptions,
            },
            {
                name: 'masterUsername',
                label: 'Master Username',
                type: 'text',
                required: true,
                group: 'Credentials',
                description: '1-16 characters, starting with a letter.',
                validation: {
                    pattern: '^[A-Za-z][A-Za-z0-9_]{0,15}$',
                    minLength: 1,
                    maxLength: 16,
                    message: 'Use 1-16 characters starting with a letter: letters, numbers, or underscores.',
                },
            },
            {
                name: 'masterUserPassword',
                label: 'Master Password',
                type: 'password',
                required: true,
                group: 'Credentials',
                description: 'At least 8 characters.',
                validation: {
                    minLength: 8,
                    maxLength: 128,
                    message: 'Master password must be at least 8 characters.',
                },
            },
        ],
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: databaseFilters,
        columns: databaseColumns,
    }
}
