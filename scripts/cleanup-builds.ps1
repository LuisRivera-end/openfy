param(
  [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output\desktop'),
  [string]$FeedRoot = (Join-Path $env:LOCALAPPDATA 'Openfy\updates\feed'),
  [switch]$IncludeLegacyTests,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-maintenance.ps1')
Clear-OpenfyBuildArtifacts $OutputDirectory $FeedRoot -IncludeLegacyTests:$IncludeLegacyTests -Apply:$Apply
