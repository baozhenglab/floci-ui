import type {CloudProvider, FieldSchema, ServiceSchema, TableColumnSchema} from './types'

const eksColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Name'},
    {name: 'status', label: 'Status'},
    {name: 'version', label: 'Version'},
    {name: 'createdAt', label: 'Created At'},
]

const eksFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
]

const versionOptions = ['1.32', '1.31', '1.30', '1.29', '1.28'].map((value) => ({
    label: value,
    value,
}))

export function awsEksSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'k8s',
        displayName: 'AWS EKS',
        fields: [
            {
                name: 'name',
                label: 'Cluster Name',
                type: 'text',
                required: true,
                description: '1-100 characters. Letters, numbers, hyphens, and underscores.',
                validation: {
                    pattern: '^[0-9A-Za-z][A-Za-z0-9_-]{0,99}$',
                    minLength: 1,
                    maxLength: 100,
                    message: 'Use a valid EKS cluster name: start alphanumeric, then letters, numbers, hyphens, or underscores.',
                },
            },
            {
                name: 'subnetIds',
                label: 'Subnet IDs',
                type: 'text',
                required: true,
                span: true,
                // Existing subnets only — the runtime rejects an unknown id with
                // InvalidParameterException. Comma-separated matches how the
                // compute schema takes security group ids.
                description: 'Two or more existing subnet IDs separated by commas — e.g. subnet-default-a, subnet-default-b',
            },
            {
                name: 'version',
                label: 'Kubernetes Version',
                type: 'select',
                required: false,
                options: versionOptions,
                description: 'Defaults to the runtime\'s own default when left unset.',
            },
            {
                name: 'roleArn',
                label: 'Cluster Role ARN',
                type: 'text',
                required: false,
                span: true,
                description: 'Optional here — real EKS requires a cluster service role.',
            },
        ],
        actions: ['list', 'inspect', 'create', 'delete'],
        filters: eksFilters,
        columns: eksColumns,
    }
}
