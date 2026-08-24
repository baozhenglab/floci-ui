import {useState} from 'react'
import {Download, Loader2, Plus, Trash2} from 'lucide-react'
import {useMutation} from '@tanstack/react-query'
import {getClusterKubeconfig} from '@/api/cloudProxyClient'
import type {EksFargateProfile, EksNodegroup} from '@/api/aws/eks.api'
import {
    useCreateEksFargateProfileMutation,
    useCreateEksNodegroupMutation,
    useDeleteEksFargateProfileMutation,
    useDeleteEksNodegroupMutation,
} from '@/api/aws/eks.mutations'
import {
    useEksFargateProfilesQuery,
    useEksNodegroupsQuery,
} from '@/api/aws/eks.queries'

interface K8sEngineDetailsProps {
    clusterName: string
}

export function K8sEngineDetails({clusterName}: K8sEngineDetailsProps) {
    return (
        <>
            <KubeconfigSection clusterName={clusterName}/>
            <EksNodegroupsSection clusterName={clusterName}/>
            <EksFargateProfilesSection clusterName={clusterName}/>
        </>
    )
}

function KubeconfigSection({clusterName}: {clusterName: string}) {
    const download = useMutation({
        mutationFn: () => getClusterKubeconfig('aws', 'k8s', clusterName),
        onSuccess: (file) => {
            // Built in the browser rather than served as a file response so the
            // request still goes through the API client (and its auth cookie).
            const url = URL.createObjectURL(
                new Blob([file.content], {type: 'application/yaml'}),
            )
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = file.filename
            anchor.click()
            URL.revokeObjectURL(url)
        },
    })

    return (
        <section className="inspector-section">
            <p className="metric-label">Cluster Access</p>
            <p className="muted compact-text">
                Download a kubeconfig for this cluster, then{' '}
                <code>export KUBECONFIG=~/Downloads/{clusterName}.kubeconfig</code>.
            </p>
            <button
                className="button compact"
                type="button"
                disabled={download.isPending}
                onClick={() => download.mutate()}
            >
                {download.isPending ? <Loader2 size={12} className="spin"/> : <Download size={12}/>}
                {download.isPending ? 'Preparing' : 'Download kubeconfig'}
            </button>
            {download.isError && (
                <p className="muted compact-text" role="alert">
                    {download.error instanceof Error
                        ? download.error.message
                        : 'Could not build a kubeconfig for this cluster.'}
                </p>
            )}
        </section>
    )
}

function EksNodegroupsSection({clusterName}: {clusterName: string}) {
    const nodegroupsQuery = useEksNodegroupsQuery(clusterName)
    const createNodegroup = useCreateEksNodegroupMutation()
    const deleteNodegroup = useDeleteEksNodegroupMutation()
    const [form, setForm] = useState({
        name: '',
        nodeRole: '',
        subnets: '',
        instanceTypes: 't3.medium',
        minSize: '1',
        desiredSize: '1',
        maxSize: '2',
    })
    const canCreate = form.name.trim() && form.nodeRole.trim() && parseCsv(form.subnets).length > 0

    return (
        <section className="inspector-section">
            <div className="inspector-section-header">
                <p className="metric-label">Managed Nodegroups</p>
                <button className="button compact" type="button" onClick={() => nodegroupsQuery.refetch()}>
                    Refresh
                </button>
            </div>
            <form
                className="inspector-action-form"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!canCreate) return

                    createNodegroup.mutate({
                        clusterName,
                        nodegroup: {
                            name: form.name.trim(),
                            nodeRole: form.nodeRole.trim(),
                            subnets: parseCsv(form.subnets),
                            instanceTypes: parseCsv(form.instanceTypes),
                            scalingConfig: {
                                minSize: Number(form.minSize),
                                desiredSize: Number(form.desiredSize),
                                maxSize: Number(form.maxSize),
                            },
                        },
                    })
                }}
            >
                <input className="input" value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} placeholder="Nodegroup name"/>
                <input className="input" value={form.nodeRole} onChange={(event) => setForm({...form, nodeRole: event.target.value})} placeholder="Node role ARN"/>
                <input className="input" value={form.subnets} onChange={(event) => setForm({...form, subnets: event.target.value})} placeholder="subnet-a, subnet-b"/>
                <input className="input" value={form.instanceTypes} onChange={(event) => setForm({...form, instanceTypes: event.target.value})} placeholder="t3.medium"/>
                <input className="input" type="number" min="0" value={form.minSize} onChange={(event) => setForm({...form, minSize: event.target.value})} placeholder="Min"/>
                <input className="input" type="number" min="0" value={form.desiredSize} onChange={(event) => setForm({...form, desiredSize: event.target.value})} placeholder="Desired"/>
                <input className="input" type="number" min="1" value={form.maxSize} onChange={(event) => setForm({...form, maxSize: event.target.value})} placeholder="Max"/>
                <button className="button compact" type="submit" disabled={!canCreate || createNodegroup.isPending}>
                    <Plus size={13}/>
                    {createNodegroup.isPending ? 'Creating' : 'Create'}
                </button>
            </form>
            {createNodegroup.isError && <p className="error-text compact-text">{errorMessage(createNodegroup.error)}</p>}
            {deleteNodegroup.isError && <p className="error-text compact-text">{errorMessage(deleteNodegroup.error)}</p>}
            <NodegroupsList
                deletingName={deleteNodegroup.variables?.nodegroupName}
                isError={nodegroupsQuery.isError}
                isLoading={nodegroupsQuery.isLoading}
                nodegroups={nodegroupsQuery.data ?? []}
                onDelete={(nodegroupName) => deleteNodegroup.mutate({clusterName, nodegroupName})}
            />
        </section>
    )
}

function EksFargateProfilesSection({clusterName}: {clusterName: string}) {
    const profilesQuery = useEksFargateProfilesQuery(clusterName)
    const createProfile = useCreateEksFargateProfileMutation()
    const deleteProfile = useDeleteEksFargateProfileMutation()
    const [form, setForm] = useState({
        name: '',
        roleArn: '',
        namespace: 'default',
        labels: '',
        subnets: '',
    })
    const canCreate = form.name.trim() && form.roleArn.trim() && form.namespace.trim()

    return (
        <section className="inspector-section">
            <div className="inspector-section-header">
                <p className="metric-label">Fargate Profiles</p>
                <button className="button compact" type="button" onClick={() => profilesQuery.refetch()}>
                    Refresh
                </button>
            </div>
            <form
                className="inspector-action-form"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!canCreate) return

                    createProfile.mutate({
                        clusterName,
                        profile: {
                            name: form.name.trim(),
                            podExecutionRoleArn: form.roleArn.trim(),
                            subnets: parseCsv(form.subnets),
                            selectors: [{
                                namespace: form.namespace.trim(),
                                labels: parseKeyValueCsv(form.labels),
                            }],
                        },
                    })
                }}
            >
                <input className="input" value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} placeholder="Profile name"/>
                <input className="input" value={form.roleArn} onChange={(event) => setForm({...form, roleArn: event.target.value})} placeholder="Pod execution role ARN"/>
                <input className="input" value={form.namespace} onChange={(event) => setForm({...form, namespace: event.target.value})} placeholder="Namespace"/>
                <input className="input" value={form.labels} onChange={(event) => setForm({...form, labels: event.target.value})} placeholder="app=api, tier=backend"/>
                <input className="input" value={form.subnets} onChange={(event) => setForm({...form, subnets: event.target.value})} placeholder="Optional subnets"/>
                <button className="button compact" type="submit" disabled={!canCreate || createProfile.isPending}>
                    <Plus size={13}/>
                    {createProfile.isPending ? 'Creating' : 'Create'}
                </button>
            </form>
            {createProfile.isError && <p className="error-text compact-text">{errorMessage(createProfile.error)}</p>}
            {deleteProfile.isError && <p className="error-text compact-text">{errorMessage(deleteProfile.error)}</p>}
            <FargateProfilesList
                deletingName={deleteProfile.variables?.profileName}
                isError={profilesQuery.isError}
                isLoading={profilesQuery.isLoading}
                profiles={profilesQuery.data ?? []}
                onDelete={(profileName) => deleteProfile.mutate({clusterName, profileName})}
            />
        </section>
    )
}

function NodegroupsList({
    nodegroups,
    isLoading,
    isError,
    deletingName,
    onDelete,
}: {
    nodegroups: EksNodegroup[]
    isLoading: boolean
    isError: boolean
    deletingName?: string
    onDelete: (nodegroupName: string) => void
}) {
    if (isLoading) return <p className="muted compact-text">Loading nodegroups.</p>
    if (isError) return <p className="error-text compact-text">Failed to load nodegroups.</p>
    if (nodegroups.length === 0) return <p className="muted compact-text">No managed nodegroups returned for this cluster.</p>

    return (
        <div className="snapshot-list">
            {nodegroups.map((nodegroup) => (
                <div className="snapshot-row" key={nodegroup.arn ?? nodegroup.name}>
                    <div>
                        <strong>{nodegroup.name}</strong>
                        <span>{nodegroup.instanceTypes.join(', ') || 'No instance types'} · {formatScaling(nodegroup)}</span>
                    </div>
                    <button
                        aria-label={`Delete ${nodegroup.name}`}
                        className="icon-btn danger"
                        type="button"
                        disabled={deletingName === nodegroup.name}
                        onClick={() => onDelete(nodegroup.name)}
                    >
                        <Trash2 size={13}/>
                    </button>
                </div>
            ))}
        </div>
    )
}

function FargateProfilesList({
    profiles,
    isLoading,
    isError,
    deletingName,
    onDelete,
}: {
    profiles: EksFargateProfile[]
    isLoading: boolean
    isError: boolean
    deletingName?: string
    onDelete: (profileName: string) => void
}) {
    if (isLoading) return <p className="muted compact-text">Loading Fargate profiles.</p>
    if (isError) return <p className="error-text compact-text">Failed to load Fargate profiles.</p>
    if (profiles.length === 0) return <p className="muted compact-text">No Fargate profiles returned for this cluster.</p>

    return (
        <div className="snapshot-list">
            {profiles.map((profile) => (
                <div className="snapshot-row" key={profile.arn ?? profile.name}>
                    <div>
                        <strong>{profile.name}</strong>
                        <span>{profile.selectors.map((selector) => selector.namespace ?? '*').join(', ') || 'No selectors'}</span>
                    </div>
                    <button
                        aria-label={`Delete ${profile.name}`}
                        className="icon-btn danger"
                        type="button"
                        disabled={deletingName === profile.name}
                        onClick={() => onDelete(profile.name)}
                    >
                        <Trash2 size={13}/>
                    </button>
                </div>
            ))}
        </div>
    )
}

function parseCsv(value: string) {
    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

function parseKeyValueCsv(value: string) {
    return Object.fromEntries(
        parseCsv(value)
            .map((part) => part.split('='))
            .filter(([key, val]) => key?.trim() && val?.trim())
            .map(([key, val]) => [key.trim(), val.trim()]),
    )
}

function formatScaling(nodegroup: EksNodegroup) {
    const scaling = nodegroup.scalingConfig
    if (!scaling) return 'No scaling config'
    return `${scaling.minSize ?? '?'}/${scaling.desiredSize ?? '?'}/${scaling.maxSize ?? '?'}`
}

function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message
    return 'The EKS operation failed.'
}
