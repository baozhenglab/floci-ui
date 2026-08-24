import type {FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const computeColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'type', label: 'Type'},
    {name: 'status', label: 'State'},
    {name: 'region', label: 'AZ'},
    {name: 'createdAt', label: 'Created'},
]

const computeFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const computeFields: FieldSchema[] = [
    // ── Required ──────────────────────────────────────────────────────
    {
        name: 'name',
        label: 'Instance Name',
        type: 'text',
        required: true,
        span: true,
        group: 'Required',
        validation: {minLength: 1, maxLength: 255, message: 'Provide a name for the instance.'},
    },
    {
        name: 'imageId',
        label: 'AMI ID',
        type: 'text',
        required: true,
        description: 'e.g. ami-0abcdef1234567890',
        validation: {
            pattern: '^ami-[0-9a-f]{8,17}$',
            message: 'Must be a valid AMI ID (ami-xxxxxxxxx).',
        },
    },
    {
        name: 'instanceType',
        label: 'Instance Type',
        type: 'select',
        required: true,
        options: [
            {label: 't2.micro',   value: 't2.micro'},
            {label: 't2.small',   value: 't2.small'},
            {label: 't2.medium',  value: 't2.medium'},
            {label: 't3.micro',   value: 't3.micro'},
            {label: 't3.small',   value: 't3.small'},
            {label: 't3.medium',  value: 't3.medium'},
            {label: 't3.large',   value: 't3.large'},
            {label: 't3.xlarge',  value: 't3.xlarge'},
            {label: 'm5.large',   value: 'm5.large'},
            {label: 'm5.xlarge',  value: 'm5.xlarge'},
            {label: 'c5.large',   value: 'c5.large'},
            {label: 'c5.xlarge',  value: 'c5.xlarge'},
        ],
    },
    // ── Networking (optional) ─────────────────────────────────────────
    {
        name: 'keyName',
        label: 'Key Pair',
        type: 'text',
        required: false,
        group: 'Networking — optional',
        description: 'Name of an existing EC2 key pair.',
    },
    {
        name: 'subnetId',
        label: 'Subnet ID',
        type: 'text',
        required: false,
        description: 'e.g. subnet-0abcdef1234567890',
    },
    {
        name: 'securityGroupIds',
        label: 'Security Group IDs',
        type: 'text',
        required: false,
        span: true,
        description: 'One or more SG IDs separated by commas — e.g. sg-111, sg-222',
    },
]

export function awsComputeSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'compute',
        displayName: 'Compute',
        fields: computeFields,
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: computeFilters,
        columns: computeColumns,
        capabilities: {
            resourceActions: [
                {name: 'list',    label: 'List',            enabled: true, status: 'available', runtimeRequired: true},
                {name: 'inspect', label: 'Inspect',         enabled: true, status: 'available', runtimeRequired: true},
                {name: 'create',  label: 'Launch instance', enabled: true, status: 'available', runtimeRequired: true},
                {name: 'delete',  label: 'Terminate',       enabled: true, status: 'available', runtimeRequired: true},
            ],
        },
    }
}
