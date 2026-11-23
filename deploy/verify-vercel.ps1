param(
  [Parameter(Mandatory = $true)][string]$DeploymentId,
  [Parameter(Mandatory = $true)][string]$DeploymentHost
)
$ErrorActionPreference = 'Stop'
$inventory = vercel.cmd api "/v6/deployments/$DeploymentId/files" --scope wattxs-projects --raw
if ($LASTEXITCODE -ne 0) { throw "Vercel source inventory request failed." }
$trees = $inventory | ConvertFrom-Json
$source = $trees | Where-Object name -EQ 'src'
if (!$source) { throw "Vercel did not return the source inventory." }

function Get-UploadedPath($entries, $parent) {
  foreach ($entry in $entries) {
    $path = "$parent$($entry.name)"
    if ($entry.type -eq 'directory') { Get-UploadedPath $entry.children "$path/" }
    else { $path }
  }
}

$files = @(Get-UploadedPath $source.children '')
if (!$files -or $files -notcontains 'package.json') { throw "Vercel source inventory is incomplete." }
$excluded = @($files | Where-Object {
  $_ -match '(^|/)(\.env(?:\.[^/]*)?|node_modules|receipts|artifacts|\.next|test-results|playwright-report)(/|$)|(?:\.key|\.pem|\.receipt\.json|\.log|-output\.txt)$'
})
if ($excluded.Length) { throw "Excluded files were present in the deployment source inventory." }

$build = @(vercel.cmd inspect $DeploymentHost --logs --no-color 2>&1 | ForEach-Object ToString)
if ($LASTEXITCODE -ne 0) { throw "Vercel build log request failed." }
if ($build -match 'Environments:\s.*\.env') { throw "Next.js reported a dotenv file during the remote build." }
$download = $build | Select-String 'Downloading \d+ deployment files' | Select-Object -Last 1
$complete = $build | Select-String 'Build Completed' | Select-Object -Last 1
if (!$download -or !$complete) { throw "Missing expected download or completion line in remote log." }
[ordered]@{
  deployment_id = $DeploymentId
  deployment_host = $DeploymentHost
  source_files = $files.Count
  excluded_files_present = $excluded.Length
  build_download_log = $download.Line.Trim()
  build_completion_log = $complete.Line.Trim()
  dotenv_reported_by_next = $false
} | ConvertTo-Json
