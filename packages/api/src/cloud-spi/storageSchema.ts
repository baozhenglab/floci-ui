import type {CapabilitySchema, CloudProvider, FieldSchema, ObjectActionName, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const storageColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'region', label: 'Region'},
    {name: 'createdAt', label: 'Created At'},
]

const storageFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const storageResourceActions: CapabilitySchema<ResourceActionName>[] = [
    {name: 'list', label: 'List resources', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'create', label: 'Create resource', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete resource', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'inspect', label: 'Inspect resource', enabled: true, status: 'available', runtimeRequired: false},
]

const storageObjectActions: CapabilitySchema<ObjectActionName>[] = [
    {name: 'list', label: 'List objects', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'upload', label: 'Upload object', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'download', label: 'Download object', enabled: true, status: 'available', runtimeRequired: true},
    {name: 'delete', label: 'Delete object', enabled: true, status: 'available', runtimeRequired: true},
    {
        name: 'createFolder',
        label: 'Create folder',
        enabled: true,
        status: 'partial',
        reason: 'Folders are represented as object key prefixes, not filesystem directories.',
        runtimeRequired: true,
    },
    {name: 'copy', label: 'Copy object', enabled: true, status: 'available', runtimeRequired: true},
]

export function awsStorageSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'storage',
        displayName: 'S3 Storage',
        fields: [
            {
                name: 'bucketName',
                label: 'Bucket Name',
                type: 'text',
                required: true,
                description: '3-63 characters. Lowercase letters, numbers, dots, and hyphens.',
                validation: {
                    pattern: '^(?!\\d+\\.\\d+\\.\\d+\\.\\d+$)(?!.*\\.\\.)(?!.*\\.-)(?!.*-\\.)(?!.*--x-s3$)(?!.*-s3alias$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$',
                    minLength: 3,
                    maxLength: 63,
                    message: 'Use a valid S3 bucket name: 3-63 lowercase characters, numbers, dots, or hyphens.',
                },
            },
            {
                name: 'region',
                label: 'Region',
                type: 'select',
                required: false,
                options: [
                    {label: 'US East (N. Virginia)', value: 'us-east-1'},
                    {label: 'US West (Oregon)', value: 'us-west-2'},
                ],
            },
        ],
        actions: ['list', 'create', 'delete', 'inspect'],
        capabilities: {
            resourceActions: storageResourceActions,
            objectActions: storageObjectActions,
        },
        filters: storageFilters,
        columns: storageColumns,
    }
}
