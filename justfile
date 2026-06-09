set shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

version := `node -p "require('./package.json').version"`
release_tag := "v" + version

bump part="patch":
    if ("{{part}}" -notin @("patch", "minor", "major", "prepatch", "preminor", "premajor", "prerelease")) { throw "Invalid bump type: {{part}}" }
    npm version "{{part}}" --no-git-tag-version
    Write-Host "Bumped package version. Run 'just tag' when ready to release."

bump-patch:
    just bump patch

bump-minor:
    just bump minor

bump-major:
    just bump major

tag:
    git rev-parse --is-inside-work-tree | Out-Null
    $localTag = git tag --list "{{release_tag}}"; if ($localTag) { throw "Tag {{release_tag}} already exists. Use 'just retag-release' to move it." }
    git tag "{{release_tag}}"
    git push origin "{{release_tag}}"
    Write-Host "Pushed release tag {{release_tag}}"

retag-release:
    git rev-parse --is-inside-work-tree | Out-Null
    $localTag = git tag --list "{{release_tag}}"; if ($localTag) { git tag -d "{{release_tag}}" }
    $remoteTag = git ls-remote --tags origin "refs/tags/{{release_tag}}"; if ($remoteTag) { git push origin ":refs/tags/{{release_tag}}" }
    git tag "{{release_tag}}"
    git push origin "{{release_tag}}"
    Write-Host "Retagged release {{release_tag}} at HEAD"
